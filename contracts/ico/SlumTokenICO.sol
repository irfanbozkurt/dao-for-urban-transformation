// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "../project_gov/SlumGovToken.sol";

contract SlumGovTokenICO {
    mapping(address => bool) public investorBought;
    address[] public investors;
    uint256[] public sales;

    address public admin;
    address public treasury;

    uint256 public endTime;
    uint256 public minPurchase;

    uint256 public collected;
    bool public released;

    modifier icoActive() {
        require(block.timestamp < endTime, "ICO is not in the active state");
        _;
    }
    modifier icoEnded() {
        require(block.timestamp >= endTime, "ICO is not at the ended state");
        _;
    }
    modifier tokenNotReleased() {
        require(!released, "Tokens must NOT have been released");
        _;
    }
    modifier investorDidntBuy() {
        require(!investorBought[msg.sender], "Already bought");
        _;
    }
    modifier onlyAdmin() {
        require(msg.sender == admin, "only admin");
        _;
    }

    constructor(address _treasury) {
        admin = msg.sender;
        treasury = _treasury;
    }

    function start(uint256 _weeks, uint256 _minPurchase) external onlyAdmin {
        require(endTime == 0 && minPurchase == 0, "Already initialized");
        require(_minPurchase > 0, "0 < _minPurchase");

        endTime = block.timestamp + _weeks * (1 weeks);
        minPurchase = _minPurchase;
    }

    function buy() external payable investorDidntBuy icoActive {
        uint256 amount = msg.value;
        require(amount >= minPurchase, "Need to buy more.");

        collected += amount;

        investorBought[msg.sender] = true;
        investors.push(msg.sender);
        sales.push(amount);

        if (amount < msg.value)
            payable(msg.sender).transfer(msg.value - amount);
    }

    function release(
        address tokenAddress
    ) external onlyAdmin icoEnded tokenNotReleased {
        SlumGovToken(tokenAddress).icoRelease(investors, sales, collected);
        selfdestruct(payable(treasury));
    }
}
