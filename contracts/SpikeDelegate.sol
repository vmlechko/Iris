// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SpikeDelegate
/// @notice EIP-7702 delegation target used ONLY to answer one question:
///         can a zero-balance EOA on Monad execute a sponsored call?
/// @dev    SPIKE ONLY. Deliberately has no access control — anyone may call
///         `execute` on a delegated account. Never ship this.
contract SpikeDelegate {
    function execute(address to, bytes calldata data)
        external
        payable
        returns (bytes memory)
    {
        (bool ok, bytes memory ret) = to.call{value: msg.value}(data);
        require(ok, "call failed");
        return ret;
    }
}
