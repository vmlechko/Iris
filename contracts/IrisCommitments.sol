// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal surface of AUSD that Iris relies on.
interface IAUSD {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);

    /// @dev ERC-3009. `to` must equal msg.sender, which is what makes it
    ///      front-running safe: nobody else can submit this authorization.
    ///      The `bytes` form is used over `(v, r, s)` because it also accepts
    ///      ERC-1271 signatures, so a smart account can fund a commitment.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}

/**
 * @title IrisCommitments
 * @notice Recurring cross-border support, funded up front and visible to the
 *         person receiving it before any of it arrives.
 *
 * A bank transfer is a promise. A commitment here is money already set aside:
 * the full schedule is escrowed when it is created, so the recipient can read
 * what is coming and when, rather than being told.
 *
 * Three properties are deliberate.
 *
 * Releases are permissionless. Once a payment is due anyone may push it — a
 * scheduler, the sender, the recipient. The recipient never has to hold gas or
 * sign anything to be paid, which is what lets them arrive through a passkey
 * with an empty account.
 *
 * Cancellation cannot claw back a payment that has already come due. A sender
 * may stop future payments and take back what is still unscheduled; what the
 * recipient is already owed stays theirs.
 *
 * All state lives here rather than in a database, and both sides are indexed,
 * so the app can rebuild everything from an address alone.
 */
contract IrisCommitments {
    struct Commitment {
        address sender;
        address recipient;
        uint128 amountPerPayment;
        uint40 interval;
        uint40 nextPaymentAt;
        uint16 paymentsTotal;
        uint16 paymentsMade;
        bool cancelled;
    }

    IAUSD public immutable token;

    Commitment[] private _commitments;

    mapping(address => uint256[]) private _outgoing;
    mapping(address => uint256[]) private _incoming;

    event CommitmentCreated(
        uint256 indexed id,
        address indexed sender,
        address indexed recipient,
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal,
        uint40 firstPaymentAt
    );
    event PaymentReleased(
        uint256 indexed id,
        address indexed recipient,
        uint128 amount,
        uint16 paymentsMade,
        uint40 nextPaymentAt
    );
    event CommitmentCancelled(uint256 indexed id, address indexed sender, uint256 refunded);

    error NotSender();
    error AlreadyCancelled();
    error NothingDue();
    error Completed();
    error InvalidSchedule();
    error TransferFailed();

    constructor(IAUSD token_) {
        token = token_;
    }

    // ---------------------------------------------------------------- create

    /// @notice Create a commitment, pulling the whole schedule via `approve`.
    /// @param startNow Release the first payment immediately, so the recipient
    ///        sees money land in the same breath as the commitment appears.
    function create(
        address recipient,
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal,
        bool startNow
    ) external returns (uint256 id) {
        uint256 total = _validate(recipient, amountPerPayment, interval, paymentsTotal);
        if (!token.transferFrom(msg.sender, address(this), total)) revert TransferFailed();
        id = _open(msg.sender, recipient, amountPerPayment, interval, paymentsTotal, startNow);
    }

    /// @notice Create a commitment from a signed ERC-3009 authorization, so the
    ///         sender needs no gas and no prior approval.
    /// @param from The account that signed the authorization and funds the
    ///        schedule. It is deliberately not msg.sender: a relayer submits
    ///        this transaction and pays for it, while AUSD verifies the
    ///        signature against `from`. The authorization names this contract
    ///        as its recipient, so nobody else can replay it elsewhere.
    function createWithAuthorization(
        address from,
        address recipient,
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal,
        bool startNow,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external returns (uint256 id) {
        uint256 total = _validateFor(from, recipient, amountPerPayment, interval, paymentsTotal);
        token.receiveWithAuthorization(
            from,
            address(this),
            total,
            validAfter,
            validBefore,
            nonce,
            signature
        );
        id = _open(from, recipient, amountPerPayment, interval, paymentsTotal, startNow);
    }

    // --------------------------------------------------------------- release

    /// @notice Push every payment that has come due. Callable by anyone.
    function release(uint256 id) external {
        Commitment storage c = _commitments[id];
        if (c.cancelled) revert AlreadyCancelled();
        if (c.paymentsMade >= c.paymentsTotal) revert Completed();
        if (block.timestamp < c.nextPaymentAt) revert NothingDue();

        uint16 due;
        // A scheduler that misses a window must not cost the recipient money,
        // so catch up on every payment whose time has passed.
        while (
            c.paymentsMade + due < c.paymentsTotal &&
            block.timestamp >= c.nextPaymentAt + uint256(c.interval) * due
        ) {
            unchecked {
                ++due;
            }
        }

        unchecked {
            c.paymentsMade += due;
            c.nextPaymentAt += uint40(uint256(c.interval) * due);
        }

        uint128 amount = uint128(uint256(c.amountPerPayment) * due);
        if (!token.transfer(c.recipient, amount)) revert TransferFailed();

        emit PaymentReleased(
            id,
            c.recipient,
            amount,
            c.paymentsMade,
            c.paymentsMade >= c.paymentsTotal ? 0 : c.nextPaymentAt
        );
    }

    // ---------------------------------------------------------------- cancel

    /// @notice Stop future payments and refund what is not yet owed.
    /// @dev A payment already due is released to the recipient first.
    function cancel(uint256 id) external {
        Commitment storage c = _commitments[id];
        if (msg.sender != c.sender) revert NotSender();
        if (c.cancelled) revert AlreadyCancelled();

        uint16 owed = block.timestamp >= c.nextPaymentAt && c.paymentsMade < c.paymentsTotal ? 1 : 0;
        uint256 remaining = uint256(c.paymentsTotal - c.paymentsMade - owed) * c.amountPerPayment;

        c.cancelled = true;

        if (owed == 1) {
            unchecked {
                ++c.paymentsMade;
            }
            if (!token.transfer(c.recipient, c.amountPerPayment)) revert TransferFailed();
            emit PaymentReleased(id, c.recipient, c.amountPerPayment, c.paymentsMade, 0);
        }
        if (remaining > 0 && !token.transfer(c.sender, remaining)) revert TransferFailed();

        emit CommitmentCancelled(id, c.sender, remaining);
    }

    // ----------------------------------------------------------------- views

    function get(uint256 id) external view returns (Commitment memory) {
        return _commitments[id];
    }

    function count() external view returns (uint256) {
        return _commitments.length;
    }

    /// @notice Commitments this address is paying out. Lets the app rebuild
    ///         everything from an address, with nothing stored locally.
    function outgoingOf(address sender) external view returns (uint256[] memory) {
        return _outgoing[sender];
    }

    /// @notice Commitments this address is receiving.
    function incomingOf(address recipient) external view returns (uint256[] memory) {
        return _incoming[recipient];
    }

    /// @notice What is claimable right now, for a caller deciding whether to
    ///         spend gas on `release`.
    function releasable(uint256 id) external view returns (uint128) {
        Commitment memory c = _commitments[id];
        if (c.cancelled || c.paymentsMade >= c.paymentsTotal) return 0;
        if (block.timestamp < c.nextPaymentAt) return 0;
        uint256 elapsed = block.timestamp - c.nextPaymentAt;
        uint256 due = 1 + elapsed / c.interval;
        uint256 left = c.paymentsTotal - c.paymentsMade;
        return uint128((due > left ? left : due) * c.amountPerPayment);
    }

    // -------------------------------------------------------------- internal

    function _validate(
        address recipient,
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal
    ) private view returns (uint256 total) {
        return _validateFor(msg.sender, recipient, amountPerPayment, interval, paymentsTotal);
    }

    function _validateFor(
        address sender,
        address recipient,
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal
    ) private pure returns (uint256 total) {
        if (
            recipient == address(0) ||
            recipient == sender ||
            sender == address(0) ||
            amountPerPayment == 0 ||
            interval == 0 ||
            paymentsTotal == 0
        ) revert InvalidSchedule();
        total = uint256(amountPerPayment) * paymentsTotal;
    }

    function _open(
        address sender,
        address recipient,
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal,
        bool startNow
    ) private returns (uint256 id) {
        id = _commitments.length;
        uint40 firstAt = startNow ? uint40(block.timestamp) : uint40(block.timestamp) + interval;

        _commitments.push(
            Commitment({
                sender: sender,
                recipient: recipient,
                amountPerPayment: amountPerPayment,
                interval: interval,
                nextPaymentAt: firstAt,
                paymentsTotal: paymentsTotal,
                paymentsMade: 0,
                cancelled: false
            })
        );
        _outgoing[sender].push(id);
        _incoming[recipient].push(id);

        emit CommitmentCreated(
            id,
            sender,
            recipient,
            amountPerPayment,
            interval,
            paymentsTotal,
            firstAt
        );

        // Instant settlement: the first payment lands as the commitment opens.
        if (startNow) {
            Commitment storage c = _commitments[id];
            c.paymentsMade = 1;
            c.nextPaymentAt = firstAt + interval;
            if (!token.transfer(recipient, amountPerPayment)) revert TransferFailed();
            emit PaymentReleased(id, recipient, amountPerPayment, 1, c.nextPaymentAt);
        }
    }
}
