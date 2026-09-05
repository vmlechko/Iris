// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Records who called it, so the spike can prove msg.sender was the
///         delegated EOA and not the sponsor.
contract Probe {
    event Seen(address indexed caller, uint256 count);

    mapping(address => uint256) public count;

    function ping() external {
        uint256 n = ++count[msg.sender];
        emit Seen(msg.sender, n);
    }
}
