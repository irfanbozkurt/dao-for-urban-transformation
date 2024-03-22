// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

contract SlumGovToken is ERC20Votes {
    uint256 constant _totalSupply = 10 ** 18;

    uint256 _icoSupply;
    address icoContract;
    address admin;

    constructor(
        address _icoContract
    ) ERC20("SlumGovToken", "GT") ERC20Permit("SlumGovToken") {
        icoContract = _icoContract;
        admin = msg.sender;
        _icoSupply = (_totalSupply / 5) * 4;
    }

    function icoRelease(
        address[] memory investors,
        uint256[] memory sales,
        uint256 totalWeiSold
    ) external {
        require(msg.sender == icoContract, "Only ICO can call this");
        for (uint256 i = 0; i < sales.length; i++)
            _mint(investors[i], (_icoSupply * sales[i]) / totalWeiSold);
        _mint(admin, _totalSupply - _icoSupply);
    }

    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint amount) internal override(ERC20Votes) {
        super._mint(to, amount);
    }

    function _burn(address account, uint amount) internal override(ERC20Votes) {
        super._burn(account, amount);
    }
}
