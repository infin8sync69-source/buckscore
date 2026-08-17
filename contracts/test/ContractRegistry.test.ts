import { expect }         from 'chai';
import { ethers }          from 'hardhat';
import { ContractRegistry } from '../typechain-types';

describe('ContractRegistry', () => {
  let registry: ContractRegistry;
  let owner:    Awaited<ReturnType<typeof ethers.getSigner>>;
  let other:    Awaited<ReturnType<typeof ethers.getSigner>>;
  let dummy:    string;

  beforeEach(async () => {
    [owner, other] = await ethers.getSigners();
    dummy = other.address;

    const Factory = await ethers.getContractFactory('ContractRegistry', owner);
    registry = await Factory.deploy() as ContractRegistry;
    await registry.waitForDeployment();
  });

  it('sets deployer as owner', async () => {
    expect(await registry.owner()).to.equal(owner.address);
  });

  it('registers a contract by name', async () => {
    await registry.registerByName('TestContract', dummy, 'v1.0');
    const found = await registry.lookupByName('TestContract');
    expect(found).to.equal(dummy);
  });

  it('registers a contract by key hash', async () => {
    const key = ethers.keccak256(ethers.toUtf8Bytes('KeyContract'));
    await registry.register(key, dummy, 'v1.0');
    expect(await registry.lookup(key)).to.equal(dummy);
  });

  it('emits ContractRegistered event', async () => {
    await expect(registry.registerByName('EvtTest', dummy, 'meta'))
      .to.emit(registry, 'ContractRegistered');
  });

  it('emits ContractUpdated event on address change', async () => {
    await registry.registerByName('UpdTest', dummy, 'v1');
    const newAddr = owner.address;
    await expect(registry.registerByName('UpdTest', newAddr, 'v2'))
      .to.emit(registry, 'ContractUpdated');
  });

  it('reverts registration from non-owner', async () => {
    await expect(
      registry.connect(other).registerByName('Hack', dummy, '')
    ).to.be.revertedWith('Registry: not owner');
  });

  it('reverts zero-address registration', async () => {
    await expect(
      registry.registerByName('Zero', ethers.ZeroAddress, '')
    ).to.be.revertedWith('Registry: zero address');
  });

  it('returns zero address for unknown key', async () => {
    const missing = await registry.lookupByName('DoesNotExist');
    expect(missing).to.equal(ethers.ZeroAddress);
  });

  it('transfers ownership', async () => {
    await registry.transferOwnership(other.address);
    expect(await registry.owner()).to.equal(other.address);
    // Old owner can no longer write.
    await expect(
      registry.registerByName('Denied', dummy, '')
    ).to.be.revertedWith('Registry: not owner');
  });

  it('enumerates entries', async () => {
    await registry.registerByName('A', dummy,         'va');
    await registry.registerByName('B', owner.address, 'vb');
    expect(await registry.totalEntries()).to.equal(2);
    const [, addrA] = await registry.entryAt(0);
    expect(addrA).to.equal(dummy);
  });
});
