import { KiteConnect } from "kiteconnect";

const kite = new KiteConnect({
  api_key: process.env.KITE_API_KEY,
});

export default kite;
