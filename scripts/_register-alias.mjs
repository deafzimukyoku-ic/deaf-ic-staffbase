/* `@/...` alias を解決する module フックを登録する。
   検証スクリプトを `node --experimental-strip-types --import ./scripts/_register-alias.mjs ...` で起動する。 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./_ts-alias-hooks.mjs', pathToFileURL(import.meta.filename));
