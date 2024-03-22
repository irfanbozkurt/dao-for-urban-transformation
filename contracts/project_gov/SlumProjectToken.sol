// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SlumProjectToken is ERC20 {
    uint256 constant _totalSupply = 10 ** 18;

    uint8 constant TOTAL_SHARE = 100;
    uint8 constant VICTIM_SHARE = 25;
    uint8 constant MAX_INVESTOR_SHARE = 60;

    uint256 public constant INVESTOR_EXPENSE_PAYMENT_DENOMINATOR = 10000000000;

    /// @param paymentRatios bought share out of 10000000000. In maximum case, this array
    /// adds up to 10000000000. In other cases, this array adds up to a smaller number.
    constructor(
        bytes32 projectHash,
        address victim,
        address[] memory investors,
        uint256[] memory paymentRatios
    ) ERC20(string(abi.encodePacked(projectHash)), "SPT") {
        uint256 _adminShare = _totalSupply;
        uint256 _victimSupply = (_totalSupply * VICTIM_SHARE) / TOTAL_SHARE;
        _mint(victim, _victimSupply);
        _adminShare -= _victimSupply;

        uint256 totalInvestorSupply = (_totalSupply * MAX_INVESTOR_SHARE) /
            TOTAL_SHARE;
        for (uint256 i = 0; i < investors.length; i++) {
            uint256 currentInvestorSupply = (totalInvestorSupply *
                paymentRatios[i]) / INVESTOR_EXPENSE_PAYMENT_DENOMINATOR;
            _mint(investors[i], currentInvestorSupply);
            _adminShare -= currentInvestorSupply;
        }

        _mint(msg.sender, _adminShare);
    }
}
