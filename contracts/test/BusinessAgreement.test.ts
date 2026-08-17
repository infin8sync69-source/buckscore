import { expect }           from 'chai';
import { ethers }            from 'hardhat';
import { BusinessAgreement } from '../typechain-types';
import { time }              from '@nomicfoundation/hardhat-network-helpers';

const ONE_BUCKS         = ethers.parseEther('1');
const APPROVAL_DEADLINE = 30 * 24 * 60 * 60; // 30 days

describe('BusinessAgreement', () => {
  let biz:      BusinessAgreement;
  let admin:    Awaited<ReturnType<typeof ethers.getSigner>>;
  let client:   Awaited<ReturnType<typeof ethers.getSigner>>;
  let provider: Awaited<ReturnType<typeof ethers.getSigner>>;
  let third:    Awaited<ReturnType<typeof ethers.getSigner>>;

  // Standard 2-milestone agreement params.
  const titles   = ['Design', 'Development'];
  const descs    = ['UI mockups', 'Full implementation'];
  const amounts  = [ONE_BUCKS, ONE_BUCKS * 2n]; // 1 + 2 = 3 BUCKS total

  beforeEach(async () => {
    [admin, client, provider, third] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory('BusinessAgreement', admin);
    biz = await Factory.deploy(
      ethers.ZeroAddress, // Soul Engine disabled
      admin.address        // protocol admin / arbiter
    ) as BusinessAgreement;
    await biz.waitForDeployment();
  });

  async function createAndFund() {
    await biz.connect(client).createAgreement(
      provider.address, 'Web Project', 'Build a website',
      titles, descs, amounts, false
    );
    await biz.connect(client).fundAgreement(0, { value: ONE_BUCKS * 3n });
  }

  // ─── Agreement creation ──────────────────────────────────────────────────

  describe('createAgreement()', () => {
    it('creates an agreement in Draft state', async () => {
      await biz.connect(client).createAgreement(
        provider.address, 'Test', 'Scope',
        titles, descs, amounts, false
      );
      const [c, p, title, total, , status] = await biz.getAgreement(0);
      expect(c).to.equal(client.address);
      expect(p).to.equal(provider.address);
      expect(title).to.equal('Test');
      expect(total).to.equal(ONE_BUCKS * 3n);
      expect(status).to.equal(0); // Draft
    });

    it('reverts self-agreement', async () => {
      await expect(
        biz.connect(client).createAgreement(
          client.address, '', '', titles, descs, amounts, false
        )
      ).to.be.revertedWith('Business: self-agreement');
    });

    it('reverts mismatched arrays', async () => {
      await expect(
        biz.connect(client).createAgreement(
          provider.address, '', '', ['Only one'], descs, amounts, false
        )
      ).to.be.revertedWith('Business: array length mismatch');
    });
  });

  // ─── Funding ─────────────────────────────────────────────────────────────

  describe('fundAgreement()', () => {
    it('activates agreement on exact payment', async () => {
      await biz.connect(client).createAgreement(
        provider.address, 'T', 'S', titles, descs, amounts, false
      );
      await biz.connect(client).fundAgreement(0, { value: ONE_BUCKS * 3n });
      const [, , , , , status] = await biz.getAgreement(0);
      expect(status).to.equal(1); // Active
    });

    it('reverts on wrong amount', async () => {
      await biz.connect(client).createAgreement(
        provider.address, 'T', 'S', titles, descs, amounts, false
      );
      await expect(
        biz.connect(client).fundAgreement(0, { value: ONE_BUCKS })
      ).to.be.revertedWith('Business: wrong amount');
    });
  });

  // ─── Happy path ───────────────────────────────────────────────────────────

  describe('Milestone happy path', () => {
    beforeEach(createAndFund);

    it('provider submits milestone 0, client approves, payment released', async () => {
      await biz.connect(provider).submitMilestone(0, 0, 'Designs done');

      const provBefore = await ethers.provider.getBalance(provider.address);
      const tx         = await biz.connect(client).approveMilestone(0, 0);
      const receipt    = await tx.wait();

      const [title, amount, status] = await biz.getMilestone(0, 0);
      expect(status).to.equal(2); // Approved

      const provAfter = await ethers.provider.getBalance(provider.address);
      // Provider received (amount - 1% fee). Allow some slack for gas.
      const expectedNet = amount - (amount * 100n / 10000n); // minus 1%
      expect(provAfter - provBefore).to.be.closeTo(expectedNet, ethers.parseEther('0.01'));
    });

    it('completes agreement when all milestones are paid', async () => {
      // Milestone 0.
      await biz.connect(provider).submitMilestone(0, 0, 'Done');
      await biz.connect(client).approveMilestone(0, 0);

      // Milestone 1.
      await biz.connect(provider).submitMilestone(0, 1, 'Done');
      await expect(biz.connect(client).approveMilestone(0, 1))
        .to.emit(biz, 'AgreementCompleted');

      const [, , , , , status] = await biz.getAgreement(0);
      expect(status).to.equal(2); // Completed
    });
  });

  // ─── Dispute ─────────────────────────────────────────────────────────────

  describe('Dispute flow', () => {
    beforeEach(createAndFund);

    it('client disputes within window', async () => {
      await biz.connect(provider).submitMilestone(0, 0, 'Done');
      await expect(biz.connect(client).disputeMilestone(0, 0))
        .to.emit(biz, 'MilestoneDisputed');

      const [title, amount, status] = await biz.getMilestone(0, 0);
      expect(status).to.equal(3); // Disputed
    });

    it('client wins dispute — milestone amount refunded', async () => {
      await biz.connect(provider).submitMilestone(0, 0, 'Claimed');
      await biz.connect(client).disputeMilestone(0, 0);

      const clientBefore = await ethers.provider.getBalance(client.address);
      await biz.connect(admin).resolveDispute(0, 0, true, 'work not delivered');
      const clientAfter = await ethers.provider.getBalance(client.address);

      expect(clientAfter - clientBefore).to.equal(ONE_BUCKS); // full milestone refunded
    });

    it('provider wins dispute — payment released', async () => {
      await biz.connect(provider).submitMilestone(0, 0, 'Done');
      await biz.connect(client).disputeMilestone(0, 0);

      const provBefore = await ethers.provider.getBalance(provider.address);
      await biz.connect(admin).resolveDispute(0, 0, false, 'work accepted');
      const provAfter = await ethers.provider.getBalance(provider.address);

      // Net of 1% fee.
      const expected = ONE_BUCKS - (ONE_BUCKS * 100n / 10000n);
      expect(provAfter - provBefore).to.be.closeTo(expected, ethers.parseEther('0.01'));
    });

    it('reverts dispute after window closes', async () => {
      await biz.connect(provider).submitMilestone(0, 0, 'Done');
      await time.increase(7 * 24 * 60 * 60 + 1); // past DISPUTE_WINDOW
      await expect(
        biz.connect(client).disputeMilestone(0, 0)
      ).to.be.revertedWith('Business: dispute window closed');
    });
  });

  // ─── Auto-approve ─────────────────────────────────────────────────────────

  describe('autoApproveMilestone()', () => {
    beforeEach(createAndFund);

    it('auto-approves after APPROVAL_DEADLINE passes', async () => {
      await biz.connect(provider).submitMilestone(0, 0, 'Done');
      await time.increase(APPROVAL_DEADLINE + 1);

      await expect(biz.autoApproveMilestone(0, 0))
        .to.emit(biz, 'AutoApproved');
    });

    it('reverts before APPROVAL_DEADLINE', async () => {
      await biz.connect(provider).submitMilestone(0, 0, 'Done');
      await expect(biz.autoApproveMilestone(0, 0))
        .to.be.revertedWith('Business: deadline not passed');
    });
  });

  // ─── Termination ──────────────────────────────────────────────────────────

  describe('requestTermination()', () => {
    beforeEach(createAndFund);

    it('terminates when both parties request', async () => {
      await biz.connect(client).requestTermination(0);
      await expect(biz.connect(provider).requestTermination(0))
        .to.emit(biz, 'AgreementTerminated');

      const [, , , , , status] = await biz.getAgreement(0);
      expect(status).to.equal(4); // Terminated
    });

    it('admin can terminate immediately', async () => {
      await expect(biz.connect(admin).adminTerminate(0))
        .to.emit(biz, 'AgreementTerminated');
    });
  });
});
