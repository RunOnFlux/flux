import axios from 'axios';

export const paymentBridge = 'https://fiatpaymentsbridge.runonflux.io';

export default async function getPaymentGateways() {
  try {
    const checkGateway = await axios.get(`${paymentBridge}/api/v1/gateway/status`);
    if (checkGateway.data.status === 'success') {
      return checkGateway.data.data;
    }
    return null;
  } catch (error) {
    return null;
  }
}
