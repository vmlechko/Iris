// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The parts of AUSD this contract uses. See IrisCommitments for why
///         the `bytes` form of ERC-3009 is used over `(v, r, s)`.
interface IAUSDSettle {
    function approve(address spender, uint256 value) external returns (bool);

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

/// @notice Agora Instant Settlement pair — the fixed-price swap.
interface IAgoraPair {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

/**
 * @title IrisSettle
 * @notice Receive a payment and settle it into another stablecoin through Agora
 *         Instant Settlement, in one transaction the recipient pays nothing for.
 *
 * The recipient in Iris holds no gas and signs no transactions. So they cannot
 * call the pair themselves: they sign an ERC-3009 authorization for their AUSD,
 * and a relayer submits it here. This contract takes the AUSD, swaps it at
 * Agora's fixed price, and hands the output straight back to the person who
 * signed. It never keeps anything between calls.
 *
 * Two properties are deliberate.
 *
 * The output always goes to the signer. There is no `to` parameter: whoever
 * relays the authorization cannot point the proceeds anywhere else.
 *
 * The floor is signed. `amountOutMin` is bound into the ERC-3009 nonce, so a
 * relayer cannot lower it after the fact. The pair's price is fixed, so on
 * testnet the floor is simply the quote; the binding matters the day a fee is
 * set.
 *
 * The contract must hold the pair's APPROVED_SWAPPER role. On testnet Agora's
 * whitelister grants it to anyone; on mainnet it follows Agora's verification.
 */
contract IrisSettle {
    IAUSDSettle public immutable ausd;
    IAgoraPair public immutable pair;
    address public immutable output;

    event Settled(address indexed who, uint256 amountIn, uint256 amountOut);

    constructor(IAUSDSettle ausd_, IAgoraPair pair_, address output_) {
        ausd = ausd_;
        pair = pair_;
        output = output_;
    }

    /// @notice The ERC-3009 nonce a recipient signs to settle with this floor.
    function settlementNonce(bytes32 salt, uint256 amountOutMin) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), salt, amountOutMin));
    }

    /// @notice What `amount` AUSD settles into right now.
    function quote(uint256 amount) external view returns (uint256) {
        return pair.getAmountsOut(amount, _path())[1];
    }

    function settle(
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        uint256 amountOutMin,
        bytes calldata signature
    ) external returns (uint256 amountOut) {
        ausd.receiveWithAuthorization(
            from,
            address(this),
            value,
            validAfter,
            validBefore,
            settlementNonce(salt, amountOutMin),
            signature
        );
        ausd.approve(address(pair), value);
        // The authorization's own expiry doubles as the swap deadline: past it,
        // the person never agreed to this swap.
        amountOut = pair.swapExactTokensForTokens(value, amountOutMin, _path(), from, validBefore)[1];
        emit Settled(from, value, amountOut);
    }

    function _path() private view returns (address[] memory path) {
        path = new address[](2);
        path[0] = address(ausd);
        path[1] = output;
    }
}
