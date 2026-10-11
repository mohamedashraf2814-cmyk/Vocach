// يجب تحميله أولاً: يوفّر Buffer لكود الخادم داخل المتصفح
import { Buffer } from 'buffer';

const toStr = Buffer.prototype.toString;
Buffer.prototype.toString = function (enc, ...rest) {
  if (enc === 'base64url') return toStr.call(this, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return toStr.call(this, enc, ...rest);
};
globalThis.Buffer = Buffer;
