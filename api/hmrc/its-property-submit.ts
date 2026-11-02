import { createItsCumulativeSubmitHandler } from './its-cumulative-submit.js';

// Same gate as the self-employment update, filed against the property business.
export default { fetch: createItsCumulativeSubmitHandler({}, undefined, 'uk-property') };
