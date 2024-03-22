// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./project_gov/ProjectManager.sol";

contract Treasury is Ownable, ProjectManager {
    uint8 public constant CONSTRUCTION_ESCROW_RATE = 5;

    event Donation(address by, uint256 amount);

    receive() external payable {}

    function donate(uint256 amount) external payable {
        require(
            msg.value >= amount,
            "Send at least the amount you want to donate"
        );

        (bool refundSuccess, ) = payable(msg.sender).call{
            value: msg.value - amount
        }("");
        require(
            refundSuccess,
            "Refund transfer to the donator failed. Reverting."
        );

        emit Donation(msg.sender, amount);
    }

    function registerProject(
        bytes32 projectHash,
        bytes32 detailsHash,
        address company,
        uint256 expense,
        address notary,
        address victim
    ) external onlyOwner {
        super._registerProject(
            projectHash,
            detailsHash,
            company,
            expense,
            notary,
            victim
        );
    }

    function giveEscrowAndStartProject(bytes32 projectHash) external payable {
        super._startProject(CONSTRUCTION_ESCROW_RATE, projectHash);
    }

    function investInProject(bytes32 projectHash) external payable {
        super._investInProject(projectHash);
    }

    function cancelProject(bytes32 projectHash) external onlyOwner {
        super._cancelProject(projectHash);
    }

    function endProject(
        bytes32 projectHash,
        address notary
    ) external onlyOwner {
        super._endProject(CONSTRUCTION_ESCROW_RATE, projectHash, notary);
    }
}
