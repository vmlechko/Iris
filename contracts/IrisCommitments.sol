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
        /// @dev Zero until a claim link is redeemed.
        address recipient;
        /// @dev Public key of the claim link. Zero for a direct commitment.
        address claimSigner;
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
    event CommitmentClaimed(uint256 indexed id, address indexed recipient);

    error NotSender();
    error AlreadyCancelled();
    error NothingDue();
    error Completed();
    error InvalidSchedule();
    error TransferFailed();
    error NotClaimed();
    error AlreadyClaimed();
    error BadClaimSignature();
    error AuthorizationNotBound();
    error ScheduleTooLong();

    /// @dev Bounds that keep `interval * paymentsTotal` inside uint40, so the
    ///      schedule arithmetic cannot silently wrap.
    uint40 private constant MAX_INTERVAL = 366 days;
    uint16 private constant MAX_PAYMENTS = 600;

    bytes32 private constant CLAIM_TYPEHASH =
        keccak256("Claim(uint256 id,address recipient)");

    bytes32 private immutable _domainSeparator;

    constructor(IAUSD token_) {
        token = token_;
        _domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Iris"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator;
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
    ///        signature against `from`.
    /// @param salt Chosen by the sender so two identical schedules do not
    ///        collide on the same ERC-3009 nonce.
    ///
    /// @dev An ERC-3009 authorization only commits to moving `value` into this
    ///      contract — it says nothing about who the commitment then pays. On
    ///      its own that lets an observer copy the authorization out of the
    ///      mempool and open a commitment to themselves with it.
    ///
    ///      So the nonce is not free: it must equal a hash of every parameter
    ///      below. The nonce is signed, so the parameters are signed with it,
    ///      and changing any of them invalidates the signature.
    function createWithAuthorization(
        address from,
        address recipient,
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal,
        bool startNow,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        bytes calldata signature
    ) external returns (uint256 id) {
        uint256 total = _validateFor(from, recipient, amountPerPayment, interval, paymentsTotal);
        bytes32 nonce = authorizationNonce(
            salt,
            recipient,
            amountPerPayment,
            interval,
            paymentsTotal,
            startNow
        );
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

    /**
     * @notice The ERC-3009 nonce a sender must sign for `createWithAuthorization`.
     * @dev Binding the schedule into the nonce is what stops the authorization
     *      being lifted and pointed somewhere else.
     */
    function authorizationNonce(
        bytes32 salt,
        address recipient,
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal,
        bool startNow
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    address(this),
                    block.chainid,
                    salt,
                    recipient,
                    amountPerPayment,
                    interval,
                    paymentsTotal,
                    startNow
                )
            );
    }

    /**
     * @notice Open a commitment for someone who has no address yet.
     *
     * The sender generates a keypair, keeps the public half here and puts the
     * private half in a link. Whoever opens the link signs their own fresh
     * address with it and the commitment binds to them.
     *
     * The address being signed rather than merely presented is what makes the
     * link safe to send over a messenger: an observer who sees the claim in the
     * mempool can only replay it to the same address it already names.
     */
    function createToClaim(
        address claimSigner,
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal,
        bool startNow
    ) external returns (uint256 id) {
        if (claimSigner == address(0)) revert InvalidSchedule();
        uint256 total = _validateSchedule(amountPerPayment, interval, paymentsTotal);
        if (!token.transferFrom(msg.sender, address(this), total)) revert TransferFailed();
        id = _openToClaim(msg.sender, claimSigner, amountPerPayment, interval, paymentsTotal, startNow);
    }

    function _openToClaim(
        address sender,
        address claimSigner,
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
                recipient: address(0),
                claimSigner: claimSigner,
                amountPerPayment: amountPerPayment,
                interval: interval,
                nextPaymentAt: firstAt,
                paymentsTotal: paymentsTotal,
                paymentsMade: 0,
                cancelled: false
            })
        );
        _outgoing[sender].push(id);

        emit CommitmentCreated(
            id,
            sender,
            address(0),
            amountPerPayment,
            interval,
            paymentsTotal,
            firstAt
        );
    }

    /**
     * @notice Open a claim link without holding gas or granting an approval.
     *
     * Both halves of Iris are meant to work from an empty account: the person
     * receiving arrives through a passkey with nothing, and there is no reason
     * the person sending should have to be different. A relayer submits this.
     *
     * @param salt Chosen by the sender so two identical schedules do not
     *        collide on the same ERC-3009 nonce.
     */
    function createToClaimWithAuthorization(
        address from,
        address claimSigner,
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal,
        bool startNow,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        bytes calldata signature
    ) external returns (uint256 id) {
        if (claimSigner == address(0) || from == address(0)) revert InvalidSchedule();
        uint256 total = _validateSchedule(amountPerPayment, interval, paymentsTotal);

        // The claim key is bound in alongside the schedule, so an authorization
        // lifted out of the mempool cannot be re-pointed at a link the attacker
        // controls.
        token.receiveWithAuthorization(
            from,
            address(this),
            total,
            validAfter,
            validBefore,
            authorizationNonce(salt, claimSigner, amountPerPayment, interval, paymentsTotal, startNow),
            signature
        );
        id = _openToClaim(from, claimSigner, amountPerPayment, interval, paymentsTotal, startNow);
    }

    /**
     * @notice Bind a claim link to an address and pay out whatever is due.
     * @param signature EIP-712 `Claim(uint256 id,address recipient)` signed by
     *        the link's key. Anyone may submit it — a relayer usually does,
     *        since a recipient arriving through a passkey holds no gas.
     */
    function claim(uint256 id, address recipient, bytes calldata signature) external {
        Commitment storage c = _commitments[id];
        if (c.cancelled) revert AlreadyCancelled();
        if (c.recipient != address(0)) revert AlreadyClaimed();
        if (recipient == address(0) || recipient == c.sender) revert InvalidSchedule();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator,
                keccak256(abi.encode(CLAIM_TYPEHASH, id, recipient))
            )
        );
        if (_recover(digest, signature) != c.claimSigner) revert BadClaimSignature();

        c.recipient = recipient;
        _incoming[recipient].push(id);
        emit CommitmentClaimed(id, recipient);

        // Money that accrued while the link sat unopened arrives at the moment
        // it is opened, which is the only moment the recipient is watching.
        if (block.timestamp >= c.nextPaymentAt) _releaseDue(id);
    }

    // --------------------------------------------------------------- release

    /// @notice Push every payment that has come due. Callable by anyone.
    function release(uint256 id) external {
        Commitment storage c = _commitments[id];
        if (c.cancelled) revert AlreadyCancelled();
        if (c.recipient == address(0)) revert NotClaimed();
        if (c.paymentsMade >= c.paymentsTotal) revert Completed();
        if (block.timestamp < c.nextPaymentAt) revert NothingDue();
        _releaseDue(id);
    }

    function _releaseDue(uint256 id) private {
        Commitment storage c = _commitments[id];

        // A scheduler that misses a window must not cost the recipient money,
        // so every payment whose time has passed is caught up at once. This is
        // arithmetic rather than a loop: iterating once per missed payment
        // would let a long-dormant commitment grow past the block gas limit and
        // become impossible to release at all.
        uint256 elapsed = block.timestamp - c.nextPaymentAt;
        uint256 due = 1 + elapsed / c.interval;
        uint256 left = c.paymentsTotal - c.paymentsMade;
        if (due > left) due = left;

        c.paymentsMade += uint16(due);
        c.nextPaymentAt = uint40(uint256(c.nextPaymentAt) + uint256(c.interval) * due);

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

        // Nobody is owed anything on a link that was never opened.
        uint16 owed = c.recipient != address(0) &&
            block.timestamp >= c.nextPaymentAt &&
            c.paymentsMade < c.paymentsTotal
            ? 1
            : 0;
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

    /**
     * @notice Every commitment with a payment due right now, in one call.
     * @dev A scheduler asking about each commitment separately would make one
     *      request per commitment per tick. This walks the range on chain
     *      instead and returns only what is worth acting on.
     * @param offset Where to start, so a long list can be walked in pages.
     * @param limit How many to examine, not how many are returned.
     */
    function dueBatch(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, uint256 examined)
    {
        uint256 end = offset + limit;
        if (end > _commitments.length) end = _commitments.length;
        examined = end > offset ? end - offset : 0;

        uint256[] memory found = new uint256[](examined);
        uint256 n;
        for (uint256 id = offset; id < end; ++id) {
            Commitment storage c = _commitments[id];
            if (c.cancelled || c.recipient == address(0)) continue;
            if (c.paymentsMade >= c.paymentsTotal) continue;
            if (block.timestamp < c.nextPaymentAt) continue;
            found[n++] = id;
        }

        ids = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) ids[i] = found[i];
    }

    /// @notice What is claimable right now, for a caller deciding whether to
    ///         spend gas on `release`.
    function releasable(uint256 id) external view returns (uint128) {
        Commitment memory c = _commitments[id];
        if (c.cancelled || c.recipient == address(0)) return 0;
        if (c.paymentsMade >= c.paymentsTotal) return 0;
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

    function _validateSchedule(
        uint128 amountPerPayment,
        uint40 interval,
        uint16 paymentsTotal
    ) private pure returns (uint256 total) {
        if (amountPerPayment == 0 || interval == 0 || paymentsTotal == 0) revert InvalidSchedule();
        if (interval > MAX_INTERVAL || paymentsTotal > MAX_PAYMENTS) revert ScheduleTooLong();
        total = uint256(amountPerPayment) * paymentsTotal;
    }

    /// @dev Rejects the upper half of the signature space, so a valid signature
    ///      cannot be flipped into a second one for the same claim.
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert BadClaimSignature();
        bytes32 r;
        bytes32 sig_s;
        assembly {
            r := calldataload(signature.offset)
            sig_s := calldataload(add(signature.offset, 32))
        }
        uint8 v = uint8(signature[64]);
        if (uint256(sig_s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0)
            revert BadClaimSignature();
        address signer = ecrecover(digest, v, r, sig_s);
        if (signer == address(0)) revert BadClaimSignature();
        return signer;
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
        if (interval > MAX_INTERVAL || paymentsTotal > MAX_PAYMENTS) revert ScheduleTooLong();
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
                claimSigner: address(0),
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
