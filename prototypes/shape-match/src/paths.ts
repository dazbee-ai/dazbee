// PROTOTYPE. Where the data lives, beside the repo by default.

/** The DeltaX test ads: a folder per ad with ad.png, blocks.json and the block crops. */
export const ADS = process.env.DELTAX_ADS ?? '../../../../ming-setup/test_ads'

/** The old worker's committed shapes baseline. */
export const OLD_BASELINE = process.env.OLD_WORKER_BASELINE ?? '../../../dx-stunnr-text-worker/shapes_baseline.json'

/**
 * The frozen DeltaX ads: every third ad in name order (index 2, 5, 8, ...). Frozen at the start of
 * round 2: no change from then on was checked on them; their numbers are reported apart.
 */
export const isFrozenAd = (ads: string[], ad: string) => [...ads].sort().indexOf(ad) % 3 === 2

/** The synthetic set read: data/synth by default, or another one generated with SYNTH_SEED. */
export const SYNTH_DIR = process.env.SYNTH_DIR ?? 'data/synth'
