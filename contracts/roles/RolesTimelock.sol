// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/governance/TimelockController.sol";

contract RolesTimelock is TimelockController {
    constructor(
        uint minDelay, // How long you have to wait before execution
        address[] memory proposers, // list of addresses that can propose
        address[] memory executors, // list of addresses that can execute
        address admin // Optional admin role (disable with zero address)
    ) TimelockController(minDelay, proposers, executors, admin) {}
}
