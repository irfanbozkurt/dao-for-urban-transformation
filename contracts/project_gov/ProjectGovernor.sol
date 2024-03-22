// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

import "../roles/RolesManager.sol";

contract ProjectGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    RolesManager private _rolesManager;

    struct CandidateProject {
        bool exists;
        address victim;
        address registeredBy;
    }
    mapping(bytes32 => CandidateProject) public candidateProjects;

    /*******************************************************************
    ********************************************************************
        Modifiers
    ********************************************************************
    *******************************************************************/
    modifier noConstructionCompanies() {
        require(
            !RolesManager(_rolesManager).constructionCompanies(msg.sender),
            "Construction companies cannot make this call."
        );
        _;
    }

    modifier onlyNotaries() {
        require(
            RolesManager(_rolesManager).notaries(msg.sender),
            "Only notaries can make this call."
        );
        _;
    }

    modifier noNotaries() {
        require(
            !RolesManager(_rolesManager).notaries(msg.sender),
            "Notaries cannot make this call."
        );
        _;
    }

    modifier onlyValidCalldata(bytes[] memory calldatas) {
        require(calldatas.length == 1, "Invalid calldata format");
        _;
    }

    /*******************************************************************
    ********************************************************************
        Events
    ********************************************************************
    *******************************************************************/
    event CandidateAdded(bytes32 ipfsHash, address addedBy);

    constructor(
        IVotes _governanceTokenAddress,
        TimelockController _timelockAddress,
        RolesManager _rolesManagerAddress,
        uint256 _votingPeriod
    )
        Governor("ProjectGovernor")
        GovernorSettings(1, _votingPeriod, 0)
        GovernorVotes(_governanceTokenAddress)
        GovernorVotesQuorumFraction(4)
        GovernorTimelockControl(_timelockAddress)
    {
        _rolesManager = _rolesManagerAddress;
    }

    /*******************************************************************
    ********************************************************************
        Business
    ********************************************************************
    *******************************************************************/

    function createCandidateProject(
        bytes32 ipfsHash,
        address victim
    ) external onlyNotaries {
        candidateProjects[ipfsHash] = CandidateProject({
            exists: true,
            victim: victim,
            registeredBy: msg.sender
        });
        emit CandidateAdded(ipfsHash, msg.sender);
    }

    function castVote(
        uint256 proposalId,
        uint8 support
    )
        public
        virtual
        override(Governor, IGovernor)
        noConstructionCompanies
        noNotaries
        returns (uint256)
    {
        return super._castVote(proposalId, msg.sender, support, "");
    }

    function castVoteWithReason(
        uint256 proposalId,
        uint8 support,
        string calldata reason
    )
        public
        virtual
        override(Governor, IGovernor)
        noConstructionCompanies
        noNotaries
        returns (uint256)
    {
        return super._castVote(proposalId, msg.sender, support, reason);
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    )
        public
        override(Governor, IGovernor)
        onlyValidCalldata(calldatas)
        returns (uint256)
    {
        bytes32 projectHash = _getParameterFromCalldata(calldatas[0], 0);
        require(
            candidateProjects[projectHash].exists,
            "No candidate project found for given hash"
        );

        if (
            // Registration proposal
            bytes4(calldatas[0]) ==
            bytes4(
                keccak256(
                    "registerProject(bytes32,bytes32,address,uint256,address,address)"
                )
            )
        ) {
            require(
                RolesManager(_rolesManager).constructionCompanies(msg.sender),
                "Only construction companies can make this call."
            );
            // Check if company passes their address, notary address, and the victim
            // address correctly. This step is crucial to ensure the correct call
            // gets executed instead of a malicious one.
            _checkAddressInCalldata(calldatas[0], 2, msg.sender);
            _checkAddressInCalldata(
                calldatas[0],
                4,
                candidateProjects[projectHash].registeredBy
            );
            _checkAddressInCalldata(
                calldatas[0],
                5,
                candidateProjects[projectHash].victim
            );
        } else if (
            // Project cancellation proposal
            bytes4(calldatas[0]) == bytes4(keccak256("cancelProject(bytes32)"))
        ) {
            require(
                !RolesManager(_rolesManager).constructionCompanies(msg.sender),
                "Construction companies are not allowed to make this call."
            );
        } else revert("Invalid function signature");

        super.hashProposal(
            targets,
            values,
            calldatas,
            keccak256(bytes(description))
        );
        return super.propose(targets, values, calldatas, description);
    }

    function _getParameterFromCalldata(
        bytes memory _calldata,
        uint8 paramOrder
    ) internal pure returns (bytes32) {
        uint8 paramBeginIndex = 4 + 32 * paramOrder; // Function sig + param offset
        bytes memory addressFromCalldata = new bytes(32);
        for (uint256 i = paramBeginIndex; i < paramBeginIndex + 32; i++)
            addressFromCalldata[i - paramBeginIndex] = _calldata[i];
        return bytes32(addressFromCalldata);
    }

    function _checkAddressInCalldata(
        bytes memory _calldata,
        uint8 paramOrder,
        address assertEqual
    ) internal pure {
        uint8 paramBeginIndex = 4 + 32 * paramOrder; // Function sig + param offset
        bytes memory addressFromCalldata = new bytes(20);
        for (uint256 i = paramBeginIndex; i < paramBeginIndex + 20; i++)
            addressFromCalldata[i - paramBeginIndex] = _calldata[i];
        require(
            bytes20(addressFromCalldata) == bytes20(abi.encode(assertEqual)),
            "Parameter not passed in correctly."
        );
    }

    /*******************************************************************
    ********************************************************************
        Inherited without change
    ********************************************************************
    *******************************************************************/

    function votingDelay()
        public
        view
        override(IGovernor, GovernorSettings)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(IGovernor, GovernorSettings)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    // The following functions are overrides required by Solidity.
    function quorum(
        uint256 blockNumber
    )
        public
        view
        override(IGovernor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function getVotes(
        address account,
        uint256 blockNumber
    ) public view override(IGovernor, Governor) returns (uint256) {
        return super.getVotes(account, blockNumber);
    }

    function state(
        uint256 proposalId
    )
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(Governor, GovernorTimelockControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
