// One private key in each WIF encoding. Whether a key is compressed is in the key
// itself, whatever network's version byte it carries.
const privateKey = '54d6bc494d210d4d8f2f3dfa37d184791604ec69c63a3d326f87e8eccfba797d';
const uncompressedPubKey = '0474eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0f070b44944941998551f9ea0e1befd96f13adf171c07c885e62d0c2af56d3dab';
const compressedPubKey = '0374eb4690689bb408139249eda7f361b7881c4254ccbe303d3b4d58c2b48897d0';

const sameKey = [
  {
    network: 'mainnet', wif: '5JTeg79dTLzzHXoJPALMWuoGDM8QmLj4n5f6MeFjx8dzsirvjAh', compressed: false, pubKey: uncompressedPubKey,
  },
  {
    network: 'mainnet', wif: 'Kz4dHc95uHGwqxwMipCRZ23C9Vqhti4ffyZ8e7S4aLiJSq5gPFQb', compressed: true, pubKey: compressedPubKey,
  },
  {
    network: 'testnet and labnet', wif: '92EHFqyB3a58FbJb1WEGPWMDs1V7vWGG82X3SGcFHsP3enyuEX9', compressed: false, pubKey: uncompressedPubKey,
  },
  {
    network: 'testnet and labnet', wif: 'cQRckX8wLLyD1QQd7E1YvLYFmj97ZAAMk1hbkXta5TNJhaAv22hX', compressed: true, pubKey: compressedPubKey,
  },
];

module.exports = { privateKey, sameKey };
