const { ethers } = require("hardhat");

/*

  CONSTANTS

*/
let deployer;

let ICO_WEEKS_DURATION = 4;
let ICO_MIN_BUY = ethers.utils.parseEther("0.001");

let MIN_VOTING_DELAY_SECONDS = 3600;
let VOTING_PERIOD_BLOCKS = 90;

/*

  CONTRACTS

*/

let treasury, icoContract, slumGovToken;

let rolesTimelock, rolesGovernor, rolesManager;
let projectTimelock, projectGovernor;

/*

  SCRIPTS

*/

const init = async () => {
  console.log(`@@@@@@@@@ BEGINNING DEPLOYMENT @@@@@@@@@\n`);
  deployer = (await ethers.getSigners())[0];
  console.log(`Deployer account: ${deployer.address}`);
};

const deploy = async () => {
  /* Deploy treasury Contract */
  treasury = await (await ethers.getContractFactory("Treasury")).deploy();
  console.log(`Treasury contract deployed at ${treasury.address}`);

  /* Deploy ICO Contract */
  icoContract = await (
    await ethers.getContractFactory("SlumGovTokenICO")
  ).deploy(treasury.address);
  await icoContract.start(ICO_WEEKS_DURATION, ICO_MIN_BUY);
  console.log(`ICO contract deployed at ${icoContract.address}`);

  /* Deploy governance token */
  slumGovToken = await (
    await ethers.getContractFactory("SlumGovToken")
  ).deploy(icoContract.address);
  console.log(`SlumGovToken contract deployed at ${slumGovToken.address}`);

  /* Deploy roles timelock */
  rolesTimelock = await (
    await ethers.getContractFactory("RolesTimelock")
  ).deploy(MIN_VOTING_DELAY_SECONDS, [], [], deployer.address);
  console.log(`RolesTimelock contract deployed at ${rolesTimelock.address}`);

  /* Deploy roles governor */
  rolesGovernor = await (
    await ethers.getContractFactory("RolesGovernor")
  ).deploy(slumGovToken.address, rolesTimelock.address, VOTING_PERIOD_BLOCKS);
  console.log(`RolesGovernor contract deployed at ${rolesGovernor.address}`);

  // Make role arrangements
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
  console.log(`RolesGovernor role arrangements done and admin role revoked.`);

  /* Deploy roles manager */
  rolesManager = await (
    await ethers.getContractFactory("RolesManager")
  ).deploy();
  await rolesManager.transferOwnership(rolesTimelock.address);
  console.log(`RolesManager contract deployed at ${rolesManager.address}`);

  /* Deploy project timelock */
  projectTimelock = await (
    await ethers.getContractFactory("ProjectTimelock")
  ).deploy(
    MIN_VOTING_DELAY_SECONDS,
    [],
    [],
    deployer.address,
    treasury.address,
    rolesManager.address
  );
  console.log(
    `ProjectTimelock contract deployed at ${projectTimelock.address}`
  );

  /* Deploy project governor */
  projectGovernor = await (
    await ethers.getContractFactory("ProjectGovernor")
  ).deploy(
    slumGovToken.address,
    projectTimelock.address,
    rolesManager.address,
    VOTING_PERIOD_BLOCKS
  );
  console.log(
    `ProjectGovernor contract deployed at ${projectGovernor.address}`
  );

  // Make role arrangements
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
  console.log(
    `Treasury contract role arrangements done and admin role revoked.`
  );

  /* Transfer treasury ownership to the timelock */
  await treasury.transferOwnership(projectTimelock.address);
  console.log(`Treasury ownership given to Timelock contract.`);
};

const finalize = async () => {
  console.log(`@@@@@@@@@ DEPLOYMENT GRACEFULLY ENDED @@@@@@@@@`);
  process.exit(0);
};

init().then(deploy).then(finalize).catch(console.error);
