import { createItsCumulativeConfirmHandler } from './its-cumulative-confirm.js';

// Same gate as the self-employment update, filed against the property business.
export default { fetch: createItsCumulativeConfirmHandler({}, undefined, 'uk-property') };
