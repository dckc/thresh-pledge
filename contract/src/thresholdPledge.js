// @ts-check
/* global harden */
import '@agoric/zoe/exported.js';
import { AmountMath } from '@agoric/ertp';
import { Far } from '@endo/marshal';
import { isAfterDeadlineExitRule } from '@agoric/zoe/src/typeGuards';

/**
 * @param {ZCF} zcf
 */
const start = async (zcf) => {
  // Create the internal token mint for a fungible digital asset. Note
  // that 'Tokens' is both the keyword and the allegedName.
  const zcfMint = await zcf.makeZCFMint('Tokens');
  // AWAIT

  // Now that ZCF has saved the issuer, brand, and local amountMath, they
  // can be accessed synchronously.
  const { issuer, brand } = zcfMint.getIssuerRecord();

  /** @type {OfferHandler} */
  const mintPayment = (seat) => {
    const amount = AmountMath.make(brand, 1000n);
    // Synchronously mint and allocate amount to seat.
    zcfMint.mintGains(harden({ Token: amount }), seat);
    // Exit the seat so that the user gets a payout.
    seat.exit();
    // Since the user is getting the payout through Zoe, we can
    // return anything here. Let's return some helpful instructions.
    return 'Offer completed. You should receive a payment from Zoe';
  };

  const pledges = [];

  const pledgeHook = async (seat) => {
    const p = seat.getProposal();
    // TODO: check for a minimum pledge?
    console.log('pledge proposal', p);

    pledges.push(seat);
    return 'Thank you for your pledge';
  };

  const publicFacet = Far('CrowdFund API', {
    makePledgeInvitation: () =>
      // TODO: proposalShape
      zcf.makeInvitation(pledgeHook, 'pledge'),
  });

  // TODO: support >1 campaign at a time?
  /** @type {ZCFSeat} */
  let beneficiarySeat;
  /** @type {OfferHandler} */
  const beneficiaryHook = async (seat) => {
    if (beneficiarySeat) throw Error('already have beneficiary');
    const p = seat.getProposal();
    if (!isAfterDeadlineExitRule(p.exit)) throw Error('no exit deadline');
    beneficiarySeat = seat;
    console.log('beneficiary', p);
    console.log('TODO: share deadline with potential contributors');

    const logged = (x) => {
      console.log('???', x);
      return x;
    };

    const claimHook = (claimSeat) => {
      const goods = harden({ Product: AmountMath.make(brand, 1n) });
      const { zcfSeat: escrow } = zcf.makeEmptySeatKit();

      beneficiarySeat.exit(true); // revoke cancellation rights

      pledges.forEach((pSeat) => {
        const pp = pSeat.getProposal();
        const gains = zcfMint.mintGains(goods);
        zcf.atomicRearrange([
          [pSeat, escrow, logged(pp.give)],
          [gains, pSeat, goods],
        ]);
      });

      zcf.atomicRearrange([[escrow, claimSeat, escrow.getCurrentAllocation()]]);
      claimSeat.exit();
      return harden({ pledges: pledges.length });
    };

    return Far('BenefitRight', {
      makeClaimInvitation: () => zcf.makeInvitation(claimHook, 'claim'),
    });
  };

  const creatorFacet = Far('CrowdFund Admin', {
    makeBeneficiaryInvitation: () =>
      zcf.makeInvitation(beneficiaryHook, 'beneficiary'),
    // The creator of the instance can send invitations to anyone
    // they wish to.
    makeInvitation: () => zcf.makeInvitation(mintPayment, 'mint a payment'),
  });

  // Return the creatorFacet to the creator, so they can make
  // invitations for others to get payments of tokens. Publish the
  // publicFacet.
  return harden({ creatorFacet, publicFacet });
};

harden(start);
export { start };
