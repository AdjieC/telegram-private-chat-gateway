const dns = require('node:dns');
const dnsPromises = require('node:dns/promises');

const originalLookup = dns.lookup.bind(dns);
const originalPromiseLookup = dnsPromises.lookup.bind(dnsPromises);

dns.lookup = function lookup(hostname, options, callback) {
  if (hostname !== 'localhost') return originalLookup(hostname, options, callback);
  const done = typeof options === 'function' ? options : callback;
  const normalizedOptions = typeof options === 'object' ? options : {};
  process.nextTick(() => {
    if (normalizedOptions.all) done(null, [{ address: '127.0.0.1', family: 4 }]);
    else done(null, '127.0.0.1', 4);
  });
};

dnsPromises.lookup = async function lookup(hostname, options = {}) {
  if (hostname !== 'localhost') return originalPromiseLookup(hostname, options);
  if (options.all) return [{ address: '127.0.0.1', family: 4 }];
  return { address: '127.0.0.1', family: 4 };
};
