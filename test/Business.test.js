const { ethers } = require("hardhat");
const { expect } = require("chai");

const { ProposalState } = require("../objects/enums.js");

const MIN_VOTING_DELAY_SECONDS = 3600;
const VOTING_PERIOD_BLOCKS = 90;
const VOTING_DELAY_BLOCKS = 1;

const TEST_PROJECT_COUNT = 5;

const deployRolesPack = async (deployer, govTokenAddress) => {
  /* Deploy roles governance system */
  rolesTimelock = await (
    await ethers.getContractFactory("RolesTimelock")
  ).deploy(MIN_VOTING_DELAY_SECONDS, [], [], deployer.address);

  rolesGovernor = await (
    await ethers.getContractFactory("RolesGovernor")
  ).deploy(govTokenAddress, rolesTimelock.address, VOTING_PERIOD_BLOCKS);

  await Promise.all([
    rolesTimelock.TIMELOCK_ADMIN_ROLE(),
    rolesTimelock.PROPOSER_ROLE(),
    rolesTimelock.EXECUTOR_ROLE(),
  ]).then(async ([admin, proposer, executor]) => {
    // Only governor can create proposals:
    await rolesTimelock.grantRole(proposer, rolesGovernor.address);
    // Executor is zero-address => Everyone
    await rolesTimelock.grantRole(
      executor,
      "0x0000000000000000000000000000000000000000"
    );
    // Revoke the admin permissions from timelock controller forever...
    await rolesTimelock.revokeRole(admin, deployer.address);
  });

  /* Deploy roles manager */
  rolesManager = await (
    await ethers.getContractFactory("RolesManager")
  ).deploy();
  await rolesManager.transferOwnership(rolesTimelock.address);

  return { rolesTimelock, rolesGovernor, rolesManager };
};

const deployProjectPack = async (
  deployer,
  govTokenAddress,
  rolesManagerAddress,
  treasury
) => {
  /* Deploy project governance system */
  projectTimelock = await (
    await ethers.getContractFactory("ProjectTimelock")
  ).deploy(
    MIN_VOTING_DELAY_SECONDS,
    [],
    [],
    deployer.address,
    treasury.address,
    rolesManagerAddress
  );

  projectGovernor = await (
    await ethers.getContractFactory("ProjectGovernor")
  ).deploy(
    govTokenAddress,
    projectTimelock.address,
    rolesManagerAddress,
    VOTING_PERIOD_BLOCKS
  );

  await Promise.all([
    projectTimelock.TIMELOCK_ADMIN_ROLE(),
    projectTimelock.PROPOSER_ROLE(),
    projectTimelock.EXECUTOR_ROLE(),
  ]).then(async ([admin, proposer, executor]) => {
    await projectTimelock.grantRole(proposer, projectGovernor.address); // Only governor can create proposals:
    await projectTimelock.grantRole(
      // Executor is zero-address => Everyone
      executor,
      "0x0000000000000000000000000000000000000000"
    );
    await projectTimelock.revokeRole(admin, deployer.address); // Revoke admin role
  });

  /* Transfer treasury ownership to the timelock */
  await treasury.transferOwnership(projectTimelock.address);

  return { projectTimelock, projectGovernor };
};

/*
    Tests are run sequentially, top to bottom.
    Tests are focused on integrations rather than units as the code
        is based on trusted 3-rd party libraries from OpenZeppelin
*/

describe("", async () => {
  let deployer;

  let icoContract;

  let ICO_WEEKS_DURATION = 4;
  let ICO_MIN_BUY = ethers.utils.parseEther("0.001");
  let ICO_MEMBER_BUY = "100";

  let notaries = [];
  let constructionCompanies = [];
  let daoMembers = [];
  let investors = [];

  let slumGovToken;

  let rolesTimelock, rolesGovernor, rolesManager;
  let projectTimelock, projectGovernor;

  let treasuryAddress;
  let treasury;

  let VOTE_WAY = 1;
  let VOTE_REASON = "I lika do da cha cha";

  let NOTARY_PROPOSAL_DESCRIPTION = "DESCHASH2";
  let CONSTRUCTION_COMPANY_PROPOSAL_DESCRIPTION = "DESCHASH3";

  let TEST_PROJECT_IPFS_HASHES = [];
  let TEST_PROPOSAL_IPFS_HASHES = [];
  let TEST_PROPOSAL_EXPENSE = ethers.utils.parseEther("120");
  let NOTARY_END_PROJECT_FEE = ethers.utils.parseEther("0.1");

  let TEST_VICTIM;

  before(async () => {
    for (let i = 0; i < TEST_PROJECT_COUNT; i++) {
      TEST_PROJECT_IPFS_HASHES.push(
        ethers.utils.hexlify(ethers.utils.randomBytes(32))
      );
      TEST_PROPOSAL_IPFS_HASHES.push(
        ethers.utils.hexlify(ethers.utils.randomBytes(32))
      );
    }

    const signers = await ethers.getSigners();
    deployer = signers[0];
    notaries = signers.slice(1, 6);
    constructionCompanies = signers.slice(6, 11);
    daoMembers = signers.slice(11, 21);
    TEST_VICTIM = signers[20];
    investors = signers.slice(22, 27);
  });

  it("DEPLOY ICO CONTRACT AND GOVERNANCE TOKEN", async () => {
    /* Deploy treasury Contract */
    treasury = await (await ethers.getContractFactory("Treasury")).deploy();
    treasuryAddress = treasury.address;

    /* Deploy ICO Contract */
    icoContract = await (
      await ethers.getContractFactory("SlumGovTokenICO")
    ).deploy(treasury.address);
    await icoContract.start(ICO_WEEKS_DURATION, ICO_MIN_BUY);

    /* Deploy governance token */
    slumGovToken = await (
      await ethers.getContractFactory("SlumGovToken")
    ).deploy(icoContract.address);
  });

  it("ICO START TO END", async () => {
    // Not reached the goal yet
    await expect(
      icoContract.release(ethers.Wallet.createRandom().address)
    ).to.be.revertedWith("ICO is not at the ended state");

    // Dao members can join the ICO by paying some ether.
    await Promise.all(
      daoMembers.map(async (member) => {
        return icoContract.connect(member).buy({
          value: ethers.utils.parseEther(ICO_MEMBER_BUY),
        });
      })
    );

    // No reentrancy to the ICO
    await Promise.all(
      daoMembers.map(async (member) => {
        await expect(icoContract.connect(member).buy()).to.be.revertedWith(
          "Already bought"
        );
      })
    );

    // CAnnot end ICO before ICO duration ends
    await expect(icoContract.release(slumGovToken.address)).to.be.revertedWith(
      "ICO is not at the ended state"
    );

    // Advance time and End the ICO
    await ethers.provider.send("evm_increaseTime", [
      ICO_WEEKS_DURATION * 7 * 24 * 60 * 60 + 1,
    ]);

    await icoContract.release(slumGovToken.address);

    // Token holders delegate their voting right to themselves
    await Promise.all(
      daoMembers.map(async (member) => {
        await slumGovToken.connect(member).delegate(member.address);
      })
    );
  });

  it("DEPLOY DAO CONTRACTS", async () => {
    const rolesContracts = await deployRolesPack(
      deployer,
      slumGovToken.address
    );
    rolesTimelock = rolesContracts.rolesTimelock;
    rolesGovernor = rolesContracts.rolesGovernor;
    rolesManager = rolesContracts.rolesManager;

    const projectContracts = await deployProjectPack(
      deployer,
      slumGovToken.address,
      rolesManager.address,
      treasury
    );
    projectTimelock = projectContracts.projectTimelock;
    projectGovernor = projectContracts.projectGovernor;
    treasury = projectContracts.treasury;
  });

  it("ROLES CANNOT BE CHANGED WITHOUT BEING VOTED", async () => {
    await expect(
      rolesManager.addNotary(notaries[0].address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(
      rolesManager.addConstructionCompany(constructionCompanies[0].address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("DAO VOTES FOR NOTARY REGISTRATION", async () => {
    // propose
    const encodedCalls = [];
    let proposalIds = [];
    for (let i = 0; i < 5; i++) {
      const encodedCall = rolesManager.interface.encodeFunctionData(
        "addNotary",
        [notaries[i].address]
      );
      encodedCalls.push(encodedCall);
      proposalIds.push(
        (
          await (
            await rolesGovernor.propose(
              [rolesManager.address],
              [0],
              [encodedCall],
              NOTARY_PROPOSAL_DESCRIPTION
            )
          ).wait()
        ).events[0].args.proposalId
      );
    }

    for (let i = 0; i < VOTING_DELAY_BLOCKS + 1; i++)
      await ethers.provider.send("evm_mine");

    // vote
    await Promise.all(
      proposalIds.map(async (proposalId) => {
        expect((await rolesGovernor.state(proposalId)).toString()).to.be.equal(
          ProposalState.Active
        );

        await Promise.all(
          daoMembers.map(async (member) => {
            await rolesGovernor
              .connect(member)
              .castVoteWithReason(proposalId, VOTE_WAY, VOTE_REASON);
          })
        );

        expect((await rolesGovernor.state(proposalId)).toString()).to.be.equal(
          ProposalState.Active
        );
      })
    );

    // Account for VOTING_PERIOD_BLOCKS
    for (let index = 0; index < VOTING_PERIOD_BLOCKS + 1; index++)
      await ethers.provider.send("evm_mine");

    await Promise.all(
      proposalIds.map(async (proposalId) => {
        expect((await rolesGovernor.state(proposalId)).toString()).to.be.equal(
          ProposalState.Succeeded
        );
      })
    );

    // queue & execute
    await Promise.all(
      encodedCalls.map(async (encodedCall) => {
        return rolesGovernor.queue(
          [rolesManager.address],
          [0],
          [encodedCall],
          ethers.utils.id(NOTARY_PROPOSAL_DESCRIPTION)
        );
      })
    );

    await Promise.all(
      proposalIds.map(async (proposalId) => {
        expect((await rolesGovernor.state(proposalId)).toString()).to.be.equal(
          ProposalState.Queued
        );
      })
    );

    // Account for MIN_DELAY_HOURS (not block number)
    await ethers.provider.send("evm_increaseTime", [
      MIN_VOTING_DELAY_SECONDS + 1,
    ]);

    await Promise.all(
      encodedCalls.map((encodedCall) => {
        return rolesGovernor.execute(
          [rolesManager.address],
          [0],
          [encodedCall],
          ethers.utils.id(NOTARY_PROPOSAL_DESCRIPTION)
        );
      })
    );

    await Promise.all(
      proposalIds.map(async (proposalId) => {
        expect((await rolesGovernor.state(proposalId)).toString()).to.be.equal(
          ProposalState.Executed
        );
      })
    );

    await Promise.all(
      notaries.map(async (notary) => {
        expect(await rolesManager.notaries(notary.address)).to.be.equal(true);
      })
    );
  });

  it("DAO VOTES FOR CONSTRUCTION COMPANY REGISTRATION", async () => {
    const encodedCalls = [];
    let proposalIds = [];
    for (let i = 0; i < 5; i++) {
      const encodedCall = rolesManager.interface.encodeFunctionData(
        "addConstructionCompany",
        [constructionCompanies[i].address]
      );
      encodedCalls.push(encodedCall);
      proposalIds.push(
        (
          await (
            await rolesGovernor.propose(
              [rolesManager.address],
              [0],
              [encodedCall],
              CONSTRUCTION_COMPANY_PROPOSAL_DESCRIPTION
            )
          ).wait()
        ).events[0].args.proposalId
      );
    }

    for (let i = 0; i < VOTING_DELAY_BLOCKS + 1; i++)
      await ethers.provider.send("evm_mine");

    // vote
    await Promise.all(
      proposalIds.map(async (proposalId) => {
        expect((await rolesGovernor.state(proposalId)).toString()).to.be.equal(
          ProposalState.Active
        );

        await Promise.all(
          daoMembers.map(async (member) => {
            await rolesGovernor
              .connect(member)
              .castVoteWithReason(proposalId, VOTE_WAY, VOTE_REASON);
          })
        );

        expect((await rolesGovernor.state(proposalId)).toString()).to.be.equal(
          ProposalState.Active
        );
      })
    );

    // Account for VOTING_PERIOD_BLOCKS
    for (let index = 0; index < VOTING_PERIOD_BLOCKS + 1; index++)
      await ethers.provider.send("evm_mine");

    await Promise.all(
      proposalIds.map(async (proposalId) => {
        expect((await rolesGovernor.state(proposalId)).toString()).to.be.equal(
          ProposalState.Succeeded
        );
      })
    );

    // queue & execute
    await Promise.all(
      encodedCalls.map(async (encodedCall) => {
        return rolesGovernor.queue(
          [rolesManager.address],
          [0],
          [encodedCall],
          ethers.utils.id(CONSTRUCTION_COMPANY_PROPOSAL_DESCRIPTION)
        );
      })
    );

    await Promise.all(
      proposalIds.map(async (proposalId) => {
        expect((await rolesGovernor.state(proposalId)).toString()).to.be.equal(
          ProposalState.Queued
        );
      })
    );

    // Account for MIN_DELAY_HOURS (not block number)
    await ethers.provider.send("evm_increaseTime", [
      MIN_VOTING_DELAY_SECONDS + 1,
    ]);

    await Promise.all(
      encodedCalls.map((encodedCall) => {
        return rolesGovernor.execute(
          [rolesManager.address],
          [0],
          [encodedCall],
          ethers.utils.id(CONSTRUCTION_COMPANY_PROPOSAL_DESCRIPTION)
        );
      })
    );

    await Promise.all(
      proposalIds.map(async (proposalId) => {
        expect((await rolesGovernor.state(proposalId)).toString()).to.be.equal(
          ProposalState.Executed
        );
      })
    );

    await Promise.all(
      constructionCompanies.map(async (constructionCompany) => {
        expect(
          await rolesManager.constructionCompanies(constructionCompany.address)
        ).to.be.equal(true);
      })
    );
  });

  it("PROJECT MANAGEMENT FUNCTIONS CAN ONLY BE CALLED THRU GOVERNANCE", async () => {
    treasury = await ethers.getContractAt("Treasury", treasuryAddress);
    await expect(
      treasury.registerProject(
        TEST_PROJECT_IPFS_HASHES[0],
        TEST_PROPOSAL_IPFS_HASHES[0],
        constructionCompanies[0].address,
        TEST_PROPOSAL_EXPENSE,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero
      )
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("ONLY NOTARIES CAN CREATE CANDIDATE PROJECTS ON GOVERNANCE CONTRACT", async () => {
    await expect(
      projectGovernor.createCandidateProject(
        TEST_PROJECT_IPFS_HASHES[0],
        TEST_VICTIM.address
      )
    ).to.be.revertedWith("Only notaries can make this call.");
  });

  it("NOTARY 0 CREATEs TWO CANDIDATE PROJECTS", async () => {
    // Notaries create 5 candidate projects
    expect(
      (await projectGovernor.candidateProjects(TEST_PROJECT_IPFS_HASHES[0]))
        .exists
    ).to.be.equal(false);
    await projectGovernor
      .connect(notaries[0])
      .createCandidateProject(TEST_PROJECT_IPFS_HASHES[0], TEST_VICTIM.address);
    await projectGovernor
      .connect(notaries[0])
      .createCandidateProject(TEST_PROJECT_IPFS_HASHES[1], TEST_VICTIM.address);
    expect(
      (await projectGovernor.candidateProjects(TEST_PROJECT_IPFS_HASHES[0]))
        .exists
    ).to.be.equal(true);
  });

  const encodedCalls_project1 = [];
  const proposalIds_project1 = [];
  let encodedCall_project2, proposalId_project2;
  it("5 PROPOSALS ON PROJECT 1, 1 PROPOSAL ON PROJECT 2", async () => {
    // construction companies make 5 proposals on 1 project
    const registeredBy1 = (
      await projectGovernor.candidateProjects(TEST_PROJECT_IPFS_HASHES[0])
    ).registeredBy;
    for (let i = 0; i < 5; i++) {
      const encodedCall = treasury.interface.encodeFunctionData(
        "registerProject",
        [
          TEST_PROJECT_IPFS_HASHES[0],
          TEST_PROPOSAL_IPFS_HASHES[i],
          constructionCompanies[i].address,
          TEST_PROPOSAL_EXPENSE,
          registeredBy1,
          TEST_VICTIM.address,
        ]
      );
      encodedCalls_project1.push(encodedCall);
      const tx = await (
        await projectGovernor
          .connect(constructionCompanies[i])
          .propose(
            [treasury.address],
            [0],
            [encodedCall],
            TEST_PROPOSAL_IPFS_HASHES[i]
          )
      ).wait();
      proposalIds_project1.push(tx.events[0].args.proposalId);
    }

    const registeredBy2 = (
      await projectGovernor.candidateProjects(TEST_PROJECT_IPFS_HASHES[1])
    ).registeredBy;
    encodedCall_project2 = treasury.interface.encodeFunctionData(
      "registerProject",
      [
        TEST_PROJECT_IPFS_HASHES[1],
        TEST_PROPOSAL_IPFS_HASHES[1], // TODO
        constructionCompanies[1].address,
        TEST_PROPOSAL_EXPENSE,
        registeredBy2,
        TEST_VICTIM.address,
      ]
    );
    const tx2 = await (
      await projectGovernor
        .connect(constructionCompanies[1])
        .propose(
          [treasury.address],
          [0],
          [encodedCall_project2],
          TEST_PROPOSAL_IPFS_HASHES[1]
        )
    ).wait();
    proposalId_project2 = tx2.events[0].args.proposalId;

    // console.log(
    //   tx2.events.map(
    //     (event) => `${Buffer.from(event.data.substring(2), "hex").toString()}`
    //   )
    // );

    // Skip the voting delay
    for (let i = 0; i < VOTING_DELAY_BLOCKS + 1; i++)
      await ethers.provider.send("evm_mine");
  });

  it("DAO VOTES PROPOSAL1 SUCCESS", async () => {
    // Notaries and construction companies cannot vote
    await expect(
      projectGovernor
        .connect(notaries[Math.trunc(Math.random() * notaries.length)])
        .castVoteWithReason(proposalIds_project1[0], VOTE_WAY, VOTE_REASON)
    ).to.be.revertedWith("Notaries cannot make this call.");
    await expect(
      projectGovernor
        .connect(
          constructionCompanies[
            Math.trunc(Math.random() * constructionCompanies.length)
          ]
        )
        .castVoteWithReason(proposalIds_project1[0], VOTE_WAY, VOTE_REASON)
    ).to.be.revertedWith("Construction companies cannot make this call.");
    expect(
      (await projectGovernor.state(proposalIds_project1[0])).toString()
    ).to.be.equal(ProposalState.Active);

    // DAO votes for first proposal
    await Promise.all(
      daoMembers.map(async (member) => {
        await projectGovernor
          .connect(member)
          .castVoteWithReason(proposalIds_project1[0], VOTE_WAY, VOTE_REASON);
      })
    );
    // DAO votes for second proposal
    await Promise.all(
      daoMembers.map(async (member) => {
        await projectGovernor
          .connect(member)
          .castVoteWithReason(proposalId_project2, VOTE_WAY, VOTE_REASON);
      })
    );

    expect(
      (await projectGovernor.state(proposalIds_project1[0])).toString()
    ).to.be.equal(ProposalState.Active);

    // Account for VOTING_PERIOD_BLOCKS
    for (let index = 0; index < VOTING_PERIOD_BLOCKS; index++)
      await ethers.provider.send("evm_mine");

    // Assert success for project1 and 2
    expect(
      (await projectGovernor.state(proposalIds_project1[0])).toString()
    ).to.be.equal(ProposalState.Succeeded);
    expect(
      (await projectGovernor.state(proposalId_project2)).toString()
    ).to.be.equal(ProposalState.Succeeded);

    // Assert failure for other projects
    await Promise.all(
      proposalIds_project1.map(async (proposalId) => {
        if (proposalId == proposalIds_project1[0]) return;
        expect(
          (await projectGovernor.state(proposalId)).toString()
        ).to.be.equal(ProposalState.Defeated);
      })
    );
  });

  it("PROPOSAL1 and PROPOSAL2 GET QUEUED AND EXECUTED", async () => {
    // queue & execute
    await projectGovernor.queue(
      [treasury.address],
      [0],
      [encodedCalls_project1[0]],
      ethers.utils.id(TEST_PROPOSAL_IPFS_HASHES[0])
    );
    await projectGovernor.queue(
      [treasury.address],
      [0],
      [encodedCall_project2],
      ethers.utils.id(TEST_PROPOSAL_IPFS_HASHES[1])
    );

    expect(
      (await projectGovernor.state(proposalIds_project1[0])).toString()
    ).to.be.equal(ProposalState.Queued);
    expect(
      (await projectGovernor.state(proposalId_project2)).toString()
    ).to.be.equal(ProposalState.Queued);

    // Account for MIN_DELAY_HOURS (not block number)
    await ethers.provider.send("evm_increaseTime", [
      MIN_VOTING_DELAY_SECONDS + 1,
    ]);

    await projectGovernor.execute(
      [treasury.address],
      [0],
      [encodedCalls_project1[0]],
      ethers.utils.id(TEST_PROPOSAL_IPFS_HASHES[0])
    );
    await projectGovernor.execute(
      [treasury.address],
      [0],
      [encodedCall_project2],
      ethers.utils.id(TEST_PROPOSAL_IPFS_HASHES[1])
    );

    expect(
      (await projectGovernor.state(proposalIds_project1[0])).toString()
    ).to.be.equal(ProposalState.Executed);

    expect(
      (
        await treasury.isRegisteredProject(TEST_PROJECT_IPFS_HASHES[0])
      ).toString()
    ).to.be.equal(TEST_PROPOSAL_IPFS_HASHES[0]);
  });

  it("WINNING COMPANIES DEPOSIT ESCROW and PAY TO NOTARY TO START THEIR PROJECTS", async () => {
    await expect(
      treasury
        .connect(constructionCompanies[1])
        .giveEscrowAndStartProject(TEST_PROJECT_IPFS_HASHES[0])
    ).to.be.revertedWith(
      "Only the proposal owner company can call this function."
    );
    await expect(
      treasury
        .connect(constructionCompanies[0])
        .giveEscrowAndStartProject(TEST_PROJECT_IPFS_HASHES[0])
    ).to.be.revertedWith(
      "Companies must stake 20% of project expense + 0,5% of the project expense to the notary to start it."
    );

    const companyBalance1 = await ethers.provider.getBalance(
      constructionCompanies[0].address
    );
    const notaryBalance1 = await ethers.provider.getBalance(
      notaries[0].address
    );
    await treasury
      .connect(constructionCompanies[0])
      .giveEscrowAndStartProject(TEST_PROJECT_IPFS_HASHES[0], {
        value: TEST_PROPOSAL_EXPENSE.div(5).add(
          TEST_PROPOSAL_EXPENSE.div(5).div(200)
        ),
      });
    const notaryBalance2 = await ethers.provider.getBalance(
      notaries[0].address
    );

    // Notary1 gets their cut
    expect(notaryBalance2.sub(notaryBalance1)).to.be.equal(
      TEST_PROPOSAL_EXPENSE.div(5).div(200)
    );

    await treasury
      .connect(constructionCompanies[1])
      .giveEscrowAndStartProject(TEST_PROJECT_IPFS_HASHES[1], {
        value: TEST_PROPOSAL_EXPENSE.div(5).add(
          TEST_PROPOSAL_EXPENSE.div(5).div(200)
        ),
      });
    expect(
      await treasury.isProjectActive(TEST_PROJECT_IPFS_HASHES[0])
    ).to.be.equal(true);
    expect(
      await treasury.isProjectActive(TEST_PROJECT_IPFS_HASHES[1])
    ).to.be.equal(true);

    const companyBalance2 = await ethers.provider.getBalance(
      constructionCompanies[0].address
    );

    expect(
      parseInt(ethers.utils.formatEther(companyBalance1.sub(companyBalance2)))
    ).to.be.equal(
      parseInt(
        ethers.utils.formatEther(
          TEST_PROPOSAL_EXPENSE.div(5).add(
            TEST_PROPOSAL_EXPENSE.div(5).div(200)
          )
        )
      )
    );
  });

  it("FAILING ASSERTIONS ON PROJECT TERMINATION", async () => {
    await expect(
      projectTimelock
        .connect(constructionCompanies[0])
        .gracefullyEndProject(TEST_PROJECT_IPFS_HASHES[0])
    ).to.nested.revertedWith("Only notaries can make this call.");
    await expect(
      projectTimelock
        .connect(notaries[0])
        .gracefullyEndProject(TEST_PROJECT_IPFS_HASHES[2])
    ).to.nested.revertedWith("Project is not active.");
    await expect(
      projectTimelock
        .connect(notaries[0])
        .gracefullyEndProject(TEST_PROJECT_IPFS_HASHES[0])
    ).to.nested.revertedWith("No payment before mininmum timespan of 6 months");
  });

  let encodedCall_cancellation, proposalId_cancellation;
  it("3 MONTHS PASS AND DAO VOTES PROJECT2 OFF TO BE CANCELLED", async () => {
    // 3 months cooldown after project starts
    await ethers.provider.send("evm_increaseTime", [90 * 24 * 60 * 61]);

    encodedCall_cancellation = treasury.interface.encodeFunctionData(
      "cancelProject",
      [TEST_PROJECT_IPFS_HASHES[1]]
    );
    proposalId_cancellation = (
      await (
        await projectGovernor
          .connect(daoMembers[1])
          .propose(
            [treasury.address],
            [0],
            [encodedCall_cancellation],
            "TEST DESCRIPTION"
          )
      ).wait()
    ).events[0].args.proposalId;
    // Skip the voting delay
    for (let i = 0; i < VOTING_DELAY_BLOCKS + 1; i++)
      await ethers.provider.send("evm_mine");

    // DAO votes for cancellation of project2
    await Promise.all(
      daoMembers.map(async (member) => {
        await projectGovernor
          .connect(member)
          .castVoteWithReason(proposalId_cancellation, VOTE_WAY, VOTE_REASON);
      })
    );

    // Account for VOTING_PERIOD_BLOCKS
    for (let index = 0; index < VOTING_PERIOD_BLOCKS; index++)
      await ethers.provider.send("evm_mine");

    // Assert success for cancellation of project2
    expect(
      (await projectGovernor.state(proposalId_cancellation)).toString()
    ).to.be.equal(ProposalState.Succeeded);

    // Queue
    await projectGovernor.queue(
      [treasury.address],
      [0],
      [encodedCall_cancellation],
      ethers.utils.id("TEST DESCRIPTION")
    );
    expect(
      (await projectGovernor.state(proposalId_cancellation)).toString()
    ).to.be.equal(ProposalState.Queued);

    // Account for MIN_DELAY_HOURS (not block number)
    await ethers.provider.send("evm_increaseTime", [
      MIN_VOTING_DELAY_SECONDS + 1,
    ]);

    expect(
      (
        await treasury.isRegisteredProject(TEST_PROJECT_IPFS_HASHES[1])
      ).toString()
    ).to.be.equal(TEST_PROPOSAL_IPFS_HASHES[1]);

    // Execute
    await projectGovernor.execute(
      [treasury.address],
      [0],
      [encodedCall_cancellation],
      ethers.utils.id("TEST DESCRIPTION")
    );
    expect(
      (await projectGovernor.state(proposalId_cancellation)).toString()
    ).to.be.equal(ProposalState.Executed);

    expect(
      (await treasury.projects(TEST_PROJECT_IPFS_HASHES[1])).cancelled
    ).to.be.equal(true);
  });

  it("INVESTORS BUY SHARE", async () => {
    await expect(
      treasury
        .connect(investors[0])
        .investInProject(TEST_PROJECT_IPFS_HASHES[0])
    ).to.be.revertedWith("You didn't send no money.");

    for (const investor of investors)
      await treasury
        .connect(investor)
        .investInProject(TEST_PROJECT_IPFS_HASHES[0], {
          value: TEST_PROPOSAL_EXPENSE.div(investors.length),
        });

    expect(
      (await treasury.projects(TEST_PROJECT_IPFS_HASHES[0]))
        .totalInvestmentCollected
    ).to.be.equal(TEST_PROPOSAL_EXPENSE);

    await expect(
      treasury
        .connect(investors[0])
        .investInProject(TEST_PROJECT_IPFS_HASHES[0], {
          value: 1,
        })
    ).to.be.revertedWith("All shares for this project are sold out.");
  });

  it("NOTARY3 TRIGGERS ESCROW REFUND AND ENDS PROJECT1", async () => {
    // Another 3 months period to end Project1
    await ethers.provider.send("evm_increaseTime", [90 * 24 * 60 * 61]);

    // Project is still active, because termination not triggered yet
    expect(
      await treasury.isProjectActive(TEST_PROJECT_IPFS_HASHES[0])
    ).to.be.equal(true);
    expect(
      await treasury.isProjectActive(TEST_PROJECT_IPFS_HASHES[1])
    ).to.be.equal(false);

    const companyBalance1 = await ethers.provider.getBalance(
      constructionCompanies[0].address
    );

    const notary3balance1 = await ethers.provider.getBalance(
      notaries[3].address
    );
    await projectTimelock
      .connect(notaries[3])
      .gracefullyEndProject(TEST_PROJECT_IPFS_HASHES[0]);
    const notary3balance2 = await ethers.provider.getBalance(
      notaries[3].address
    );
    const companyBalance2 = await ethers.provider.getBalance(
      constructionCompanies[0].address
    );

    // Company gets their escrow back
    expect(
      ethers.utils.formatEther(TEST_PROPOSAL_EXPENSE.mul(6).div(5))
    ).to.be.equal(
      ethers.utils.formatEther(companyBalance2.sub(companyBalance1).toString())
    );

    // Assert that notary is paid the termination fee
    expect(
      ethers.utils.formatEther(
        NOTARY_END_PROJECT_FEE.sub(notary3balance2.sub(notary3balance1))
      ) < ethers.utils.formatEther(ethers.utils.parseEther("0.001"))
    ).to.be.equal(true);

    // Some more assertions
    await expect(
      projectTimelock
        .connect(notaries[1])
        .gracefullyEndProject(TEST_PROJECT_IPFS_HASHES[1])
    ).to.be.revertedWith("Project is not active.");
    expect(
      await treasury.isProjectActive(TEST_PROJECT_IPFS_HASHES[0])
    ).to.be.equal(false);
    expect(
      (await treasury.projects(TEST_PROJECT_IPFS_HASHES[0])).done
    ).to.be.equal(true);
    expect(
      (await treasury.projects(TEST_PROJECT_IPFS_HASHES[1])).done
    ).to.be.equal(false);
  });

  it("COMPANY2 LOST THEIR ESCROW TO THE DAO", async () => {
    expect(
      (
        await ethers.provider.getBalance(
          constructionCompanies[constructionCompanies.length - 1].address
        )
      ).sub(
        await ethers.provider.getBalance(constructionCompanies[1].address)
      ) > TEST_PROPOSAL_EXPENSE.div(5)
    ).to.be.equal(true);
  });

  it("VICTIM AND DAO GOT THEIR SHARE FROM THE NEW DEPLOYED PROJECT TOKEN", async () => {
    const projectToken = await ethers.getContractAt(
      "SlumProjectToken",
      (
        await treasury.projects(TEST_PROJECT_IPFS_HASHES[0])
      ).token
    );

    let totalSupply = ethers.utils.parseEther("0");
    for (let i = 0; i < investors.length; i++)
      totalSupply = totalSupply.add(
        await projectToken.balanceOf(investors[0].address)
      );

    totalSupply = totalSupply.add(
      await projectToken.balanceOf(treasury.address)
    );
    totalSupply = totalSupply.add(
      await projectToken.balanceOf(TEST_VICTIM.address)
    );

    expect(await projectToken.totalSupply()).to.be.equal(totalSupply);
  });
});
