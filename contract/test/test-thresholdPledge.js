// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { test as anyTest } from './prepare-test-env-ava.js';
import path from 'path';
import bundleSource from '@endo/bundle-source';
import { makeZoeKitForTest } from '@agoric/zoe/tools/setup-zoe.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';

import { E } from '@endo/far';
import { makePromiseKit } from '@endo/promise-kit';
import { AmountMath, makeIssuerKit } from '@agoric/ertp';
import { TimeMath } from '@agoric/time';

import { withAmountUtils } from './supports.js';

const DAY = 24 * 60 * 60 * 1000;

const filename = new URL(import.meta.url).pathname;
const dirname = path.dirname(filename);

const contractPath = `${dirname}/../src/thresholdPledge.js`;

/** @type {import('ava').TestFn<Awaited<ReturnType<makeTestContext>>>} */
const test = anyTest;

const makeTestContext = async (t) => {
  // pack the contract
  const bundle = await bundleSource(contractPath);
  const { zoeService: zoe } = makeZoeKitForTest();

  const eventLoopIteration = () => new Promise(setImmediate);
  return { zoe, bundle, eventLoopIteration };
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
  const {
    issuers: { Tokens: tokenIssuer },
  } = await E(zoe).getTerms(instance);
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
    instance: makePromiseKit(),
    publicFacet: makePromiseKit(),
    alicePledge: makePromiseKit(),
    bobPledge: makePromiseKit(),
    charliePledge: makePromiseKit(),
    muchTime: makePromiseKit(),
  };
  Object.entries(sync).forEach(([name, { promise }]) => {
    promise.then((r) => console.log('++ SYNC', name, 'resolved to', r));
  });

  const logged = (x) => {
    console.log('@@@', x);
    return x;
  };

  /** @param {ERef<import('@agoric/time/src/types').TimerService>} timerP */
  const bella = async (timerP, dur = BigInt(14 * DAY), goal = 100_000) => {
    const { creatorFacet, publicFacet, instance } = await E(zoe).startInstance(
      crowdFundInstall,
      { Money: money.issuer },
    );
    console.log('fund:', { creatorFacet, publicFacet });
    sync.publicFacet.resolve(publicFacet);
    sync.instance.resolve(instance);

    const t0 = await E(timerP).getCurrentTimestamp();
    const timer = await timerP;
    const deadline = TimeMath.addAbsRel(
      t0,
      TimeMath.relValue(
        harden({
          timerBrand: t0.timerBrand,
          relValue: dur,
        }),
      ),
    );
    const beneficiarySeat = await E(zoe).offer(
      logged(await E(creatorFacet).makeBeneficiaryInvitation()),
      harden({
        want: { Money: money.units(goal) },
        exit: { afterDeadline: { deadline, timer } },
      }),
    );
    const benefitRight = await E(beneficiarySeat).getOfferResult();

    t.log('@@benefitRight', benefitRight);
    const tryClaim = async () => {
      const claimSeat = await E(zoe).offer(
        await E(benefitRight).makeClaimInvitation(),
      );
      const result = await E(claimSeat).getOfferResult();
      t.is(result, 'TODO@@@');
    };
    console.log('bell tries to exit immediately');
    await t.throwsAsync(tryClaim(), { message: /onDemand/ }, 'claim early');

    await sync.alicePledge.promise;
    await t.throwsAsync(tryClaim(), { message: /onDemand/ }, 'claim early');
    await sync.bobPledge.promise;
    await t.throwsAsync(E(beneficiarySeat).tryExit(), undefined, 'claim early');

    await sync.muchTime.promise;
    const benefit = await E(beneficiarySeat).getPayout('Money');
    await t.notThrowsAsync(E(money.issuer).getAmountOf(benefit), 'claim');
    await t.throwsAsync(
      E(beneficiarySeat).tryExit(),
      undefined,
      'claim again?',
    );
  };

  /**
   * @param {ERef<Purse<'nat'>>} purseP
   * @param {Amount<'nat'>} amt
   */
  const pledge = async (purseP, amt) => {
    const {
      brands: { Tokens: productBrand },
    } = await E(zoe).getTerms(await sync.instance.promise);

    const proposal = {
      give: { Money: amt },
      want: { Product: AmountMath.make(productBrand, 1n) },
    };

    const seat = await E(zoe).offer(
      await E(sync.publicFacet.promise).makePledgeInvitation(),
      proposal,
      { Money: await E(purseP).withdraw(amt) },
    );

    const result = await E(seat).getOfferResult();
    t.log('pledge result', result);
    return seat;
  };

  /** @param {ERef<Purse<'nat'>>} purseP */
  const alice = async (purseP, amt = money.units(60_000)) => {
    console.log('alice contributes 60K');

    const aliceSeat = await pledge(purseP, amt);

    sync.alicePledge.resolve(true);
    await sync.muchTime.promise;
    await E(aliceSeat).tryExit();
    const pp = await E(aliceSeat).getPayouts();

    const {
      brands: { Tokens: productBrand },
      issuers: { Tokens: productIssuer },
    } = await E(zoe).getTerms(await sync.instance.promise);
    const issuers = {
      Money: money.issuer,
      Product: productIssuer,
    };
    const payoutAmounts = Object.fromEntries(
      await Promise.all(
        Object.entries(pp).map(async ([kw, pmtP]) => {
          const pmt = await pmtP;
          const amt = await E(issuers[kw]).getAmountOf(pmt);
          /** @type {[ keyof typeof issuers, Amount ]} */
          const entry = [kw, amt];
          return entry;
        }),
      ),
    );
    t.log(payoutAmounts);
    t.true(
      AmountMath.isEqual(
        payoutAmounts.Product,
        AmountMath.make(productBrand, 1n),
      ),
    );
  };

  /** @param {ERef<Purse<'nat'>>} purseP */
  const bob = async (purseP, amt = money.units(30_000)) => {
    console.log('Bob contributes 30K');
    const bobSeat = await pledge(purseP, amt);
    sync.bobPledge.resolve(true);

    await sync.muchTime.promise;
    await t.throwsAsync(E(bobSeat).withdraw(), undefined, "bob can't withdraw");
  };

  const charlie = async (purseP, amt = money.units(50_000)) => {
    console.log('Charlie contributes 50K');
    const charlieSeat = await pledge(purseP, amt);
    sync.charliePledge.resolve(true);
  };

  const timer = buildManualTimer(t.log, BigInt((2020 - 1970) * 365.25 * DAY), {
    timeStep: BigInt(DAY),
    eventLoopIteration: t.context.eventLoopIteration,
  });

  const doTimer = async () => {
    for (let d = 0; d < 15; d++) {
      await timer.tick(`day ${d}`);
    }
    sync.muchTime.resolve(true);
  };

  /** @type {(amount: Amount<'nat'>) => Promise<Purse<'nat'>>} */
  async function _faucet(amount) {
    const purse = money.issuer.makeEmptyPurse();
    purse.deposit(money.mint.mintPayment(amount));
    return purse;
  }

  await Promise.all([
    bella(timer),
    alice(_faucet(money.units(60_000))),
    bob(_faucet(money.units(30_000))),
    charlie(_faucet(money.units(50_000))),
    doTimer(),
  ]);
});
