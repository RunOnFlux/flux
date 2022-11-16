/**
 * Changes XML to JSON
 * Modified version from: https://gist.github.com/chinchang/8106a82c56ad007e27b1#file-xmltojson-js
 * @param {string} xml XML DOM tree
 */
function xmlToJson(xml) {
  // Create the return object
  let obj = {};

  // eslint-disable-next-line eqeqeq
  if (xml.nodeType == 1) {
    // element
    // do attributes
    if (xml.attributes.length > 0) {
      obj['@attributes'] = {};
      for (let j = 0; j < xml.attributes.length; j += 1) {
        const attribute = xml.attributes.item(j);
        obj['@attributes'][attribute.nodeName] = attribute.nodeValue;
      }
    }
  // eslint-disable-next-line eqeqeq
  } else if (xml.nodeType == 3) {
    // text
    obj = xml.nodeValue;
  }

  // do children
  // If all text nodes inside, get concatenated text from them.
  const textNodes = [].slice.call(xml.childNodes).filter((node) => node.nodeType === 3);
  if (xml.hasChildNodes() && xml.childNodes.length === textNodes.length) {
    obj = [].slice.call(xml.childNodes).reduce((text, node) => text + node.nodeValue, '');
  } else if (xml.hasChildNodes()) {
    for (let i = 0; i < xml.childNodes.length; i += 1) {
      const item = xml.childNodes.item(i);
      const { nodeName } = item;
      if (typeof obj[nodeName] === 'undefined') {
        obj[nodeName] = xmlToJson(item);
      } else {
        if (typeof obj[nodeName].push === 'undefined') {
          const old = obj[nodeName];
          obj[nodeName] = [];
          obj[nodeName].push(old);
        }
        obj[nodeName].push(xmlToJson(item));
      }
    }
  }
  return obj;
}

module.exports = {
  xmlToJson,
};
