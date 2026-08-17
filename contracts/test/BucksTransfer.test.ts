import { expect }       from 'chai';
import { ethers }        from 'hardhat';
import { BucksTransfer } from '../typechain-types';

const ONE_BUCKS = ethers.parseEther('1');
const ONE_DAY   = 24 * 60 * 60;

describe('BucksTransfer', () => {
  let transfer: BucksTransfer;
  let payer:    Awaited<ReturnType<typeof ethers.getSigner>>;
  let payee:    Awaited<ReturnType<typeof ethers.getSigner>>;
  let third:    Awaited<ReturnType<typeof ethers.getSigner>>;

  beforeEach(async () => {
    [payer, payee, third] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory('BucksTransfer', payer);
    // Deploy with zero address → Soul Engine disabled (dev mode).
    transfer = await Factory.deploy(ethers.ZeroAddress) as BucksTransfer;
    await transfer.waitForDeployment();
  });

  // ─── Direct transfer ────────────────────────────────────────────────────

  describe('transfer()', () => {
    it('sends BUCKS and emits DirectTransfer', async () => {
      const before = await ethers.provider.getBalance(payee.address);
      await expect(
        transfer.transfer(payee.address, 'test memo', false, { value: ONE_BUCKS })
      )
        .to.emit(transfer, 'DirectTransfer')
        .withArgs(payer.address, payee.address, ONE_BUCKS, 'test memo');

      const after = await ethers.provider.getBalance(payee.address);
      expect(after - before).to.equal(ONE_BUCKS);
    });

    it('reverts on zero value', async () => {
      await expect(
        transfer.transfer(payee.address, '', false, { value: 0 })
      ).to.be.revertedWith('BucksTransfer: zero value');
    });

    it('reverts on self-transfer', async () => {
      await expect(
        transfer.transfer(payer.address, '', false, { value: ONE_BUCKS })
      ).to.be.revertedWith('BucksTransfer: self-transfer');
    });

    it('reverts on zero address', async () => {
      await expect(
        transfer.transfer(ethers.ZeroAddress, '', false, { value: ONE_BUCKS })
      ).to.be.revertedWith('BucksTransfer: zero address');
    });

    it('skips soul gate when disabled (address(0))', async () => {
      // soulGated=true but engine is address(0) → should still succeed.
      await expect(
        transfer.transfer(payee.address, 'memo', true, { value: ONE_BUCKS })
      ).to.emit(transfer, 'DirectTransfer');
    });
  });

  // ─── Payment agreements ─────────────────────────────────────────────────

  describe('createAgreement()', () => {
    it('creates and stores an agreement', async () => {
      const releaseAt = Math.floor(Date.now() / 1000) + ONE_DAY;
      const tx = await transfer.createAgreement(
        payee.address, releaseAt, 0, false, 'deal', { value: ONE_BUCKS }
      );
      await tx.wait();

      const agr = await transfer.agreements(0);
      expect(agr.payer).to.equal(payer.address);
      expect(agr.payee).to.equal(payee.address);
      expect(agr.amount).to.equal(ONE_BUCKS);
      expect(agr.releaseAt).to.equal(releaseAt);
      expect(agr.status).to.equal(0); // Pending
    });

    it('reverts on release in the past', async () => {
      await expect(
        transfer.createAgreement(
          payee.address, 1, 0, false, '', { value: ONE_BUCKS }
        )
      ).to.be.revertedWith('BucksTransfer: release in past');
    });
  });

  describe('claimAgreement()', () => {
    it('payee cannot claim before release date', async () => {
      const releaseAt = Math.floor(Date.now() / 1000) + ONE_DAY;
      await transfer.createAgreement(
        payee.address, releaseAt, 0, false, '', { value: ONE_BUCKS }
      );
      await expect(
        transfer.connect(payee).claimAgreement(0)
      ).to.be.revertedWith('BucksTransfer: too early');
    });

    it('non-payee cannot claim', async () => {
      const releaseAt = Math.floor(Date.now() / 1000) + ONE_DAY;
      await transfer.createAgreement(
        payee.address, releaseAt, 0, false, '', { value: ONE_BUCKS }
      );
      await expect(
        transfer.connect(third).claimAgreement(0)
      ).to.be.revertedWith('BucksTransfer: not payee');
    });
  });

  describe('cancelAgreement()', () => {
    it('payer can cancel before release date and gets refund', async () => {
      const releaseAt = Math.floor(Date.now() / 1000) + ONE_DAY;
      await transfer.createAgreement(
        payee.address, releaseAt, 0, false, '', { value: ONE_BUCKS }
      );

      const before = await ethers.provider.getBalance(payer.address);
      const tx = await transfer.connect(payer).cancelAgreement(0);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(payer.address);

      // Refund minus gas should be close to ONE_BUCKS.
      expect(after - before + gasUsed).to.be.closeTo(ONE_BUCKS, ethers.parseEther('0.001'));

      const agr = await transfer.agreements(0);
      expect(agr.status).to.equal(2); // Cancelled
    });

    it('third party cannot cancel', async () => {
      const releaseAt = Math.floor(Date.now() / 1000) + ONE_DAY;
      await transfer.createAgreement(
        payee.address, releaseAt, 0, false, '', { value: ONE_BUCKS }
      );
      await expect(
        transfer.connect(third).cancelAgreement(0)
      ).to.be.revertedWith('BucksTransfer: not party');
    });
  });

  describe('totalAgreements()', () => {
    it('increments on each agreement creation', async () => {
      const releaseAt = Math.floor(Date.now() / 1000) + ONE_DAY;
      await transfer.createAgreement(payee.address, releaseAt, 0, false, '', { value: ONE_BUCKS });
      await transfer.createAgreement(payee.address, releaseAt, 0, false, '', { value: ONE_BUCKS });
      expect(await transfer.totalAgreements()).to.equal(2);
    });
  });
});
