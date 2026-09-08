// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IrisDelegate
 * @notice Lets an account act on chain without ever holding gas.
 *
 * Some things only the sender may do — cancelling a commitment is the one that
 * matters here — and the contract checks `msg.sender` to decide. A relayer
 * cannot stand in for them, and our sender is a passkey account that holds
 * exactly nothing, so it cannot pay for the transaction either.
 *
 * EIP-7702 closes that gap. The account signs an authorization pointing at this
 * code; a sponsor submits the transaction and pays for it; and the call runs
 * with the account itself as `msg.sender`.
 *
 * @dev The spike version of this had no access control at all, which would have
 *      let anyone execute anything through a delegated account. Here the
 *      account signs the exact call, and this contract will run nothing else:
 *
 *      - the digest binds the account, the chain, the target, the calldata and
 *        a nonce, so a signature cannot be moved to another call, another
 *        chain, another account, or replayed;
 *      - the nonce lives in the account's own storage, because delegated code
 *        reads and writes the account it is delegated to;
 *      - the upper half of the signature space is rejected, so a valid
 *        signature cannot be flipped into a second valid one.
 *
 *      The sponsor chooses only whether to pay. It cannot change what runs.
 */
contract IrisDelegate {
    /// @notice Next expected nonce for this account. Storage belongs to the EOA.
    uint256 public nonce;

    error BadSignature();
    error WrongNonce(uint256 given, uint256 expected);
    error CallFailed(bytes reason);

    event Executed(address indexed to, uint256 nonce);

    /// @notice What the account must sign to authorise one call.
    function digest(address to, bytes calldata data, uint256 forNonce)
        public
        view
        returns (bytes32)
    {
        bytes32 inner = keccak256(
            abi.encode(address(this), block.chainid, to, keccak256(data), forNonce)
        );
        // EIP-191, so a wallet showing this to a person cannot be tricked into
        // signing something that is also a valid transaction.
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    /**
     * @notice Run one call as this account, paid for by whoever submits it.
     * @param to Contract to call.
     * @param data Calldata, signed in full — not a shape the sponsor may fill in.
     * @param forNonce Must equal the current nonce.
     * @param signature The account's own signature over `digest`.
     */
    function execute(address to, bytes calldata data, uint256 forNonce, bytes calldata signature)
        external
        returns (bytes memory)
    {
        if (forNonce != nonce) revert WrongNonce(forNonce, nonce);
        if (_recover(digest(to, data, forNonce), signature) != address(this)) revert BadSignature();

        // Bumped before the call, so a target that calls back cannot replay it.
        unchecked {
            nonce = forNonce + 1;
        }

        (bool ok, bytes memory ret) = to.call(data);
        if (!ok) revert CallFailed(ret);

        emit Executed(to, forNonce);
        return ret;
    }

    function _recover(bytes32 hash, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
        }
        uint8 v = uint8(signature[64]);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0)
            revert BadSignature();
        address signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }
}
