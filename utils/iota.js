const { utf8ToHex } = require("@iota/sdk");

const TaggedDomain = Object.freeze({
  ELECTRICITY: "Electricity",
  GAS: "Gas",
  WATER: "Water",
});

function getTaggedDomain(tag) {
  switch (tag) {
    case TaggedDomain.ELECTRICITY:
      return "http://127.0.0.1:14265";
    case TaggedDomain.GAS:
      return "http://127.0.0.1:14365";
    case TaggedDomain.WATER:
      return "http://127.0.0.1:14465";
    default:
      return null;
  }
}

async function storeData(tag, data) {
  const domain = getTaggedDomain(tag);
  console.log(
    JSON.stringify({
      protocolVersion: 2,
      payload: {
        type: 5,
        tag: utf8ToHex(tag),
        data: utf8ToHex(JSON.stringify({ data })),
      },
    })
  )
  if (!domain) return null;
  const timestamp = Date.now();
  const response = await fetch(`${domain}/api/core/v2/blocks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      protocolVersion: 2,
      payload: {
        type: 5,
        tag: utf8ToHex(tag),
        data: utf8ToHex(JSON.stringify({ data })),
      },
    }),
  });
  const blockId = (await response.json()).blockId;
  return { blockId, timestamp };
}

async function queryData(tag, blockId) {
  const domain = getTaggedDomain(tag);
  if (!domain) return null;
  const response = await fetch(`${domain}/api/core/v2/blocks/${blockId}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return await response.json();
}

module.exports = { storeData, queryData };
