// @ts-check
import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp/src/amountMath.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { Stable } from '@agoric/inter-protocol/src/tokens.js';

// adapted from inter-protocol/test/supports.js
// https://github.com/Agoric/agoric-sdk/blob/9f3fadee9a91266c61367b8b93eb6187855765d4/packages/inter-protocol/test/supports.js
/** @param {Pick<IssuerKit<'nat'>, 'brand' | 'issuer' | 'mint'>} kit */
export const withAmountUtils = (kit) => {
  const decimalPlaces =
    kit.issuer.getDisplayInfo?.()?.decimalPlaces ??
    Stable.displayInfo.decimalPlaces;

  return {
    ...kit,
    /** @param {NatValue} v */
    make: (v) => AmountMath.make(kit.brand, v),
    makeEmpty: () => AmountMath.makeEmpty(kit.brand),
    /**
     * @param {NatValue} n
     * @param {NatValue} [d]
     */
    makeRatio: (n, d) => makeRatio(n, kit.brand, d),
    /** @param {number} n */
    units: (n) =>
      AmountMath.make(kit.brand, BigInt(Math.round(n * 10 ** decimalPlaces))),
  };
};
/** @typedef {ReturnType<typeof withAmountUtils>} AmountUtils */
