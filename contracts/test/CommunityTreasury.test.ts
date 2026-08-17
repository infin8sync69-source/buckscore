import { expect }           from 'chai';
import { ethers }            from 'hardhat';
import { CommunityTreasury } from '../typechain-types';
import { time }              from '@nomicfoundation/hardhat-network-helpers';

const ONE_BUCKS   = ethers.parseEther('1');
const VOTING_SEC  = 3 * 24 * 60 * 60; // 3 days

async function deployFreshCommunity(admin: Awaited<ReturnType<typeof ethers.getSigner>>) {
  const Factory = await ethers.getContractFactory('CommunityTreasury', admin);
  const c = await Factory.deploy(
    'Test Community',
    'A test community',
    0,               // free membership
    VOTING_SEC,
    3000,            // 30% quorum
    false,           // not soul-gated
    ethers.ZeroAddress
  ) as CommunityTreasury;
  await c.waitForDeployment();
  return c;
}

describe('CommunityTreasury', () => {
  let community: CommunityTreasury;
  let admin:     Awaited<ReturnType<typeof ethers.getSigner>>;
  let alice:     Awaited<ReturnType<typeof ethers.getSigner>>;
  let bob:       Awaited<ReturnType<typeof ethers.getSigner>>;
  let carol:     Awaited<ReturnType<typeof ethers.getSigner>>;

  beforeEach(async () => {
    [admin, alice, bob, carol] = await ethers.getSigners();
    community = await deployFreshCommunity(admin);

    // Add members.
    await community.connect(alice).join();
    await community.connect(bob).join();
    await community.connect(carol).join();
  });

  // ─── Membership ──────────────────────────────────────────────────────────

  describe('join()', () => {
    it('adds a member', async () => {
      expect(await community.isMember(alice.address)).to.be.true;
    });

    it('increments member count', async () => {
      expect(await community.memberCount()).to.equal(4); // admin + 3
    });

    it('reverts double-join', async () => {
      await expect(community.connect(alice).join())
        .to.be.revertedWith('Community: already member');
    });

    it('emits MemberJoined', async () => {
      const [, , , , newMember] = await ethers.getSigners();
      await expect(community.connect(newMember).join())
        .to.emit(community, 'MemberJoined');
    });
  });

  describe('leave()', () => {
    it('removes a member', async () => {
      await community.connect(alice).leave();
      expect(await community.isMember(alice.address)).to.be.false;
    });

    it('admin cannot leave', async () => {
      await expect(community.connect(admin).leave())
        .to.be.revertedWith('Community: admin cannot leave');
    });
  });

  // ─── Treasury ─────────────────────────────────────────────────────────────

  describe('donate()', () => {
    it('accepts donations and updates balance', async () => {
      await community.donate({ value: ONE_BUCKS });
      expect(await community.treasuryBalance()).to.equal(ONE_BUCKS);
    });

    it('accepts plain send via receive()', async () => {
      await admin.sendTransaction({ to: await community.getAddress(), value: ONE_BUCKS });
      expect(await community.treasuryBalance()).to.equal(ONE_BUCKS);
    });
  });

  // ─── Proposals & governance ───────────────────────────────────────────────

  describe('BUCKS_TRANSFER proposal', () => {
    it('creates, votes yes, and executes a payment proposal', async () => {
      // Fund the treasury first.
      await community.donate({ value: ONE_BUCKS * 5n });

      const recipient = carol.address;
      const amount    = ONE_BUCKS;

      // Member proposes.
      const tx = await community.connect(alice)
        .proposeBucksTransfer(recipient, amount, 'pay carol');
      await tx.wait();

      // Members vote yes.
      await community.connect(alice).vote(0, true);
      await community.connect(bob).vote(0, true);
      await community.connect(admin).vote(0, true);

      // Advance past voting period.
      await time.increase(VOTING_SEC + 1);

      const carolBefore = await ethers.provider.getBalance(carol.address);

      // Execute.
      await expect(community.execute(0))
        .to.emit(community, 'ProposalExecuted');

      const carolAfter = await ethers.provider.getBalance(carol.address);
      expect(carolAfter - carolBefore).to.equal(amount);
    });

    it('rejects proposal when quorum not met', async () => {
      await community.donate({ value: ONE_BUCKS * 5n });
      await community.connect(alice).proposeBucksTransfer(carol.address, ONE_BUCKS, 'pay');

      // 0 votes — 0% < quorum (30% of 4 members = 1.2 -> 2 votes needed).
      await time.increase(VOTING_SEC + 1);

      await expect(community.execute(0))
        .to.emit(community, 'ProposalRejected');
    });
  });

  describe('MEMBER_REMOVE proposal', () => {
    it('removes a member on majority vote', async () => {
      await community.connect(alice).proposeMemberRemoval(bob.address, 'bad actor');

      await community.connect(alice).vote(0, true);
      await community.connect(carol).vote(0, true);
      await community.connect(admin).vote(0, true);

      await time.increase(VOTING_SEC + 1);

      await expect(community.execute(0)).to.emit(community, 'ProposalExecuted');
      expect(await community.isMember(bob.address)).to.be.false;
    });
  });

  describe('Double-vote protection', () => {
    it('reverts second vote from same address', async () => {
      await community.donate({ value: ONE_BUCKS * 5n });
      await community.connect(alice).proposeBucksTransfer(carol.address, ONE_BUCKS, '');
      await community.connect(alice).vote(0, true);
      await expect(community.connect(alice).vote(0, true))
        .to.be.revertedWith('Community: already voted');
    });
  });

  describe('Non-member cannot vote or propose', () => {
    it('reverts vote from non-member', async () => {
      const [, , , , outsider] = await ethers.getSigners();
      await community.donate({ value: ONE_BUCKS * 5n });
      await community.connect(alice).proposeBucksTransfer(carol.address, ONE_BUCKS, '');
      await expect(community.connect(outsider).vote(0, true))
        .to.be.revertedWith('Community: not member');
    });
  });
});
