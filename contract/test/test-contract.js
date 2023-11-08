// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { test as anyTest } from './prepare-test-env-ava.js';
import path from 'path';

import bundleSource from '@endo/bundle-source';

import { E } from '@endo/far';
import { makePromiseKit } from '@endo/promise-kit';
import { makeZoeKitForTest } from '@agoric/zoe/tools/setup-zoe.js';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';

import { withAmountUtils } from './supports.js';

const DAY = 24 * 60 * 60 * 1000;

const filename = new URL(import.meta.url).pathname;
const dirname = path.dirname(filename);

const contractPath = `${dirname}/../src/contract.js`;

/** @type {import('ava').TestFn<Awaited<ReturnType<makeTestContext>>>} */
const test = anyTest;

const makeTestContext = async (t) => {
  // pack the contract
  const bundle = await bundleSource(contractPath);
  const { zoeService: zoe } = makeZoeKitForTest();
  return { zoe, bundle };
};

test.before(async (t) => (t.context = await makeTestContext(t)));

test('zoe - mint payments', async (t) => {
  const { zoe, bundle } = t.context;

  // install the contract
  const installation = E(zoe).install(bundle);

  const { creatorFacet, instance } = await E(zoe).startInstance(installation);

  // Alice makes an invitation for Bob that will give him 1000 tokens
  const invitation = E(creatorFacet).makeInvitation();

  // Bob makes an offer using the invitation
  const seat = E(zoe).offer(invitation);

  const paymentP = E(seat).getPayout('Token');

  // Let's get the tokenIssuer from the contract so we can evaluate
  // what we get as our payout
  const publicFacet = E(zoe).getPublicFacet(instance);
  const tokenIssuer = E(publicFacet).getTokenIssuer();
  const tokenBrand = await E(tokenIssuer).getBrand();

  const tokens1000 = AmountMath.make(tokenBrand, 1000n);
  const tokenPayoutAmount = await E(tokenIssuer).getAmountOf(paymentP);

  // Bob got 1000 tokens
  t.deepEqual(tokenPayoutAmount, tokens1000);
});

test('crowdfund', async (t) => {
  const { zoe, bundle } = t.context;

  // minting IST in a test is a royal PITA
  // const ist = await withAmountUtils(E(zoe).getFeeIssuer());
  const money = withAmountUtils(makeIssuerKit('M'));

  // install the contract
  const crowdFundInstall = E(zoe).install(bundle);

  const sync = {
    publicFacet: makePromiseKit(),
    aliceDonate: makePromiseKit(),
    bobDonate: makePromiseKit(),
    muchTime: makePromiseKit(),
  };

  const logged = (x) => {
    console.log('@@@', x);
    return x;
  };

  const bella = async () => {
    const deadline = 'TODO: 14 days';
    const { creatorFacet, publicFacet } = await E(zoe).startInstance(
      crowdFundInstall,
      { Donation: money.issuer },
      {
        price: money.units(100_000),
        deadline,
      },
    );
    console.log('fund:', { creatorFacet, publicFacet });
    sync.publicFacet.resolve(publicFacet);

    const beneficiarySeat = await E(zoe).offer(
      logged(await E(creatorFacet).makeBeneficiaryInvitation()),
    );
    const benefitRight = await E(beneficiarySeat).getOfferResult();
    await t.throwsAsync(E(benefitRight).claim(), undefined, 'claim early');

    await sync.aliceDonate.promise;
    await t.throwsAsync(E(benefitRight).claim(), undefined, 'claim early');
    await sync.bobDonate.promise;
    await t.throwsAsync(E(benefitRight).claim(), undefined, 'claim early');

    await sync.muchTime.promise;
    const { benefit } = E.get(E(benefitRight).claim());
    await t.notThrowsAsync(E(money.issuer).getAmountOf(benefit), 'claim');
    await t.throwsAsync(benefit.claim(), undefined, 'claim again?');
  };

  /**
   * @param {ERef<Purse<'nat'>>} purseP
   * @param {Amount<'nat'>} amt
   */
  const contribute = async (purseP, amt) => {
    const proposal = { give: { Donation: amt } };

    const seat = await E(zoe).offer(
      await E(sync.publicFacet.promise).makeContributeInvitation(),
      proposal,
      { Donation: await E(purseP).withdraw(amt) },
    );

    return seat;
  };

  /** @param {ERef<Purse<'nat'>>} purseP */
  const alice = async (purseP, amt = money.units(60_000)) => {
    console.log('alice contributes 60K');

    const aliceSeat = await contribute(purseP, amt);

    sync.aliceDonated.resolve();
  };

  /** @param {ERef<Purse<'nat'>>} purseP */
  const bob = async (purseP, amt = money.units(30_000)) => {
    console.log('Bob contributes 30K');
    const bobSeat = await contribute(purseP, amt);

    await sync.muchTime.promise;
    await t.throwsAsync(E(bobSeat).withdraw(), undefined, "bob can't withdraw");
  };

  const charlie = async (purseP, amt = money.units(50_000)) => {
    console.log('Charlie contributes 50K');
    const charlieSeat = await contribute(purseP, amt);
  };

  const timer = async (t0) => {
    console.log('15 days pass - TODO');
    // _registry.setCurrentBlock({
    //   blockNumber: 123,
    //   timestamp: now + 15 * DAY,
    // });
    sync.muchTime.resolve();
  };

  /** @type {(amount: Amount<'nat'>) => Promise<Purse<'nat'>>} */
  async function _faucet(amount) {
    const purse = money.issuer.makeEmptyPurse();
    purse.deposit(money.mint.mintPayment(amount));
    return purse;
  }

  await Promise.all([
    bella(),
    alice(_faucet(money.units(60_000))),
    bob(_faucet(money.units(30_000))),
    charlie(_faucet(money.units(50_000))),
    timer((2020 - 1970) * 365.25 * DAY),
  ]);
});
