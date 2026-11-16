import { expect, it } from 'vitest';
import { getCaptureRuntimeUrl } from '@/sdk/runtime-loader';

const APP = { appOrigin: 'https://app.example.com', path: '/sdk/capture-runtime-K3XQ2ABC.js' };
const RUNTIME_URL = 'https://app.example.com/sdk/capture-runtime-K3XQ2ABC.js';
const DEPLOYMENT_ID = 'dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3';

it.each([
  {
    name: 'asks the app for the runtime file as is when sdk.js was built outside Vercel',
    deploymentId: null, failedLoads: 0, expected: RUNTIME_URL,
  },
  {
    name: 'pins the request to the deployment when sdk.js was built on Vercel',
    deploymentId: DEPLOYMENT_ID, failedLoads: 0, expected: `${RUNTIME_URL}?dpl=${DEPLOYMENT_ID}`,
  },
  {
    name: 'asks under a new address after failed loads',
    deploymentId: null, failedLoads: 2, expected: `${RUNTIME_URL}?retry=2`,
  },
  {
    name: 'keeps the pin when it asks again',
    deploymentId: DEPLOYMENT_ID, failedLoads: 1, expected: `${RUNTIME_URL}?dpl=${DEPLOYMENT_ID}&retry=1`,
  },
])('$name', ({ deploymentId, failedLoads, expected }) => {
  expect(getCaptureRuntimeUrl({ ...APP, deploymentId }, failedLoads)).toBe(expected);
});
