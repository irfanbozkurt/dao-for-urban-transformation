// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";

contract RolesManager is Ownable {
    mapping(address => bool) public notaries;
    mapping(address => bool) public constructionCompanies;

    function addNotary(address notary) external onlyOwner {
        notaries[notary] = true;
    }

    function removeNotary(address notary) external onlyOwner {
        notaries[notary] = false;
    }

    function addConstructionCompany(address company) external onlyOwner {
        constructionCompanies[company] = true;
    }

    function removeConstructionCompany(address company) external onlyOwner {
        constructionCompanies[company] = false;
    }
}
