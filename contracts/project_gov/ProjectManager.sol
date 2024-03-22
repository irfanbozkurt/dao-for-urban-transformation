// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./SlumProjectToken.sol";

contract ProjectManager {
    uint32 public constant MIN_CONSTRUCTION_TIME_DAYS = 180 days;
    uint32 public constant MIN_CANCELLATION_TIME_DAYS = 90 days;

    uint32 public constant NOTARY_START_PROJECT_CUT_RATIO_TO_EXPENSE = 200; // expense / 200
    uint256 public constant NOTARY_END_PROJECT_FEE_WEI = 1 ether / 10;

    uint256 public constant INVESTOR_EXPENSE_PAYMENT_DENOMINATOR = 10000000000;

    struct ProjectDetails {
        bool exists;
        bytes32 ipfsHash;
        address registeredBy;
        address victim;
        address company;
        uint256 expense;
        uint256 startTime;
        bool cancelled;
        uint256 endTime;
        bool done;
        address token;
        uint256 totalInvestmentCollected;
        address[] investors;
        uint256[] investorPaymentRatios;
    }

    mapping(bytes32 => ProjectDetails) public projects;
    mapping(bytes32 => bool) public isProjectActive;

    modifier onlyProposalOwner(bytes32 projectHash) {
        require(
            msg.sender == projects[projectHash].company,
            "Only the proposal owner company can call this function."
        );
        _;
    }

    modifier projectNotActive(bytes32 projectHash) {
        require(!isProjectActive[projectHash], "Project is already active.");
        _;
    }

    modifier projectActive(bytes32 projectHash) {
        require(isProjectActive[projectHash], "Project is not active.");
        _;
    }

    modifier projectNotDone(bytes32 projectHash) {
        require(
            !projects[projectHash].done,
            "Project is already done and payment is made."
        );
        _;
    }

    modifier projectNotCancelled(bytes32 projectHash) {
        require(!projects[projectHash].cancelled, "This project is cancelled.");
        _;
    }

    function _registerProject(
        bytes32 projectHash,
        bytes32 detailsHash,
        address company,
        uint256 expense,
        address registeredBy,
        address victim
    ) internal {
        require(!projects[projectHash].done, "Project already registered");

        address[] memory investors;
        uint256[] memory investorPaymentRatios;
        projects[projectHash] = ProjectDetails({
            exists: true,
            ipfsHash: detailsHash,
            registeredBy: registeredBy,
            victim: victim,
            company: company,
            expense: expense,
            startTime: 0,
            endTime: 0,
            done: false,
            cancelled: false,
            token: address(0),
            totalInvestmentCollected: 0,
            investors: investors,
            investorPaymentRatios: investorPaymentRatios
        });
    }

    function _startProject(
        uint8 escrowRate,
        bytes32 projectHash
    )
        internal
        onlyProposalOwner(projectHash)
        projectNotActive(projectHash)
        projectNotDone(projectHash)
    {
        uint256 escrow = projects[projectHash].expense / escrowRate;
        uint256 notaryCut = escrow / NOTARY_START_PROJECT_CUT_RATIO_TO_EXPENSE;
        require(
            msg.value >= escrow + notaryCut,
            "Companies must stake 20% of project expense + 0,5% of the project expense to the notary to start it."
        );

        isProjectActive[projectHash] = true;
        projects[projectHash].startTime = block.timestamp;

        (bool notaryCutGiven, ) = payable(projects[projectHash].registeredBy)
            .call{value: notaryCut}("");
        require(
            notaryCutGiven,
            "Refund transfer to the company failed. Reverting."
        );

        uint256 refund = msg.value - escrow - notaryCut;
        if (refund > 0) {
            (bool refundGiven, ) = payable(msg.sender).call{value: refund}("");
            require(
                refundGiven,
                "Refund transfer to the company failed. Reverting."
            );
        }
    }

    function _investInProject(
        bytes32 projectHash
    )
        internal
        projectActive(projectHash)
        projectNotDone(projectHash)
        projectNotCancelled(projectHash)
    {
        uint256 investment = msg.value;
        require(investment > 0, "You didn't send no money.");
        require(
            projects[projectHash].totalInvestmentCollected <
                projects[projectHash].expense,
            "All shares for this project are sold out."
        );

        if (
            projects[projectHash].totalInvestmentCollected + investment >
            projects[projectHash].expense
        ) {
            investment =
                projects[projectHash].expense -
                projects[projectHash].totalInvestmentCollected;
        }

        projects[projectHash].totalInvestmentCollected += investment;
        projects[projectHash].investors.push(msg.sender);
        projects[projectHash].investorPaymentRatios.push(
            (investment * INVESTOR_EXPENSE_PAYMENT_DENOMINATOR) /
                projects[projectHash].expense
        );

        if (investment < msg.value) {
            (bool refund, ) = payable(msg.sender).call{
                value: msg.value - investment
            }("");
            require(
                refund,
                "Refund transfer to the investor failed. Reverting."
            );
        }
    }

    function _cancelProject(
        bytes32 projectHash
    )
        internal
        projectNotCancelled(projectHash)
        projectActive(projectHash)
        projectNotDone(projectHash)
    {
        require(
            block.timestamp >
                projects[projectHash].startTime + MIN_CANCELLATION_TIME_DAYS &&
                block.timestamp <
                projects[projectHash].startTime + MIN_CONSTRUCTION_TIME_DAYS,
            "Cancellation must occur after between 4 months and 6 months"
        );

        uint256 expense = projects[projectHash].expense;
        for (uint256 i = 0; i < projects[projectHash].investors.length; i++) {
            uint256 investmentInWei = (projects[projectHash]
                .investorPaymentRatios[i] * expense) /
                INVESTOR_EXPENSE_PAYMENT_DENOMINATOR;

            (bool refund, ) = payable(projects[projectHash].investors[i]).call{
                value: investmentInWei
            }("");
            require(
                refund,
                "Refund transfer to the investor failed. Reverting."
            );
        }

        projects[projectHash].cancelled = true;
        isProjectActive[projectHash] = false;
    }

    function _endProject(
        uint8 escrowRate,
        bytes32 projectHash,
        address notary
    )
        internal
        projectActive(projectHash)
        projectNotDone(projectHash)
        projectNotCancelled(projectHash)
    {
        require(
            block.timestamp >
                projects[projectHash].startTime + MIN_CONSTRUCTION_TIME_DAYS,
            "No payment before mininmum timespan of 6 months"
        );

        projects[projectHash].done = true;
        isProjectActive[projectHash] = false;
        projects[projectHash].endTime = block.timestamp;

        // Pay the expense + escrow to the company
        (bool success, ) = payable(projects[projectHash].company).call{
            value: projects[projectHash].expense +
                projects[projectHash].expense /
                escrowRate
        }("");
        require(success, "Payment to the construction company failed.");

        // Pay the ending fee to the notary
        (bool endFeePaidToNotary, ) = payable(notary).call{
            value: NOTARY_END_PROJECT_FEE_WEI
        }("");
        require(
            endFeePaidToNotary,
            "Ending fee could not be paid to the notary."
        );

        // Deploy a new SlumProjectToken (ERC20) for the project
        projects[projectHash].token = address(
            new SlumProjectToken(
                projectHash,
                projects[projectHash].victim,
                projects[projectHash].investors,
                projects[projectHash].investorPaymentRatios
            )
        );
    }

    function isRegisteredProject(
        bytes32 projectHash
    ) public view returns (bytes32) {
        return projects[projectHash].ipfsHash;
    }
}
