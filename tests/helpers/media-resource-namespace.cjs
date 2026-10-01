/** evaluate序列化函数没有动态import回调；由真实CJS模块执行只读ESM身份探针。 */
module.exports = function importMediaNamespace(entry) {
  return import(require('node:url').pathToFileURL(entry).href)
}
