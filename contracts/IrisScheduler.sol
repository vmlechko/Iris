// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @notice Receives Keystone reports from a Chainlink CRE workflow.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

interface IIris {
    function release(uint256 id) external;
}

/**
 * @title IrisScheduler
 * @notice Turns a schedule into settlement, and records the rate money arrived at.
 *
 * A commitment says a payment is due; something still has to push it. Doing
 * that from a server would put the product's promise behind an uptime
 * guarantee nobody can verify, so the schedule runs as a Chainlink CRE workflow
 * instead: it wakes on cron, reads which commitments have come due, fetches the
 * day's exchange rate, and delivers both in one signed report.
 *
 * The rate matters because the number a recipient cares about is what lands in
 * their own currency, not what left the sender's account. Recording it at the
 * moment of settlement makes that figure checkable afterwards rather than an
 * estimate the interface drew.
 *
 * Releasing is permissionless on Iris itself, so this contract has no special
 * power over anyone's money. If the workflow stops, payments are simply pushed
 * by whoever wants them pushed — the recipient included.
 */
contract IrisScheduler is IReceiver {
    IIris public immutable iris;

    /// @notice The Chainlink Forwarder allowed to deliver reports.
    address public immutable forwarder;

    /// @notice Rate in units of the quote currency per USD, scaled by 1e6.
    struct Rate {
        bytes3 currency;
        uint64 value;
        uint40 observedAt;
    }

    Rate public latestRate;

    event PaymentsReleased(uint256 releasedCount, uint256 skippedCount);
    event PaymentSkipped(uint256 indexed id);
    event RateRecorded(bytes3 indexed currency, uint64 value, uint40 observedAt);

    error InvalidSender(address sender, address expected);
    error ZeroAddress();

    constructor(IIris iris_, address forwarder_) {
        if (address(iris_) == address(0) || forwarder_ == address(0)) revert ZeroAddress();
        iris = iris_;
        forwarder = forwarder_;
    }

    /// @param report abi.encode(uint256[] ids, bytes3 currency, uint64 rate)
    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert InvalidSender(msg.sender, forwarder);

        (uint256[] memory ids, bytes3 currency, uint64 rate) = abi.decode(
            report,
            (uint256[], bytes3, uint64)
        );

        uint256 released;
        uint256 skipped;
        for (uint256 i = 0; i < ids.length; ++i) {
            // One commitment that cannot pay — a frozen recipient, a schedule
            // already finished — must not hold up everyone else in the batch.
            try iris.release(ids[i]) {
                unchecked {
                    ++released;
                }
            } catch {
                unchecked {
                    ++skipped;
                }
                emit PaymentSkipped(ids[i]);
            }
        }

        if (rate != 0) {
            latestRate = Rate({
                currency: currency,
                value: rate,
                observedAt: uint40(block.timestamp)
            });
            emit RateRecorded(currency, rate, uint40(block.timestamp));
        }

        emit PaymentsReleased(released, skipped);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
