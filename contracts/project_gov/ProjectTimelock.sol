// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/governance/TimelockController.sol";

import "../Treasury.sol";
import "../roles/RolesManager.sol";

contract ProjectTimelock is TimelockController {
    RolesManager private _rolesManager;
    Treasury private _treasury;

    constructor(
        uint minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin, // To be disabled with zero address
        Treasury treasury,
        RolesManager _rolesManagerAddress
    ) TimelockController(minDelay, proposers, executors, admin) {
        _treasury = treasury;
        _rolesManager = _rolesManagerAddress;
    }

    // Only the notaries
    function gracefullyEndProject(bytes32 projectHash) external {
        require(
            _rolesManager.notaries(msg.sender),
            "Only notaries can make this call."
        );
        _treasury.endProject(projectHash, msg.sender);
    }
}
