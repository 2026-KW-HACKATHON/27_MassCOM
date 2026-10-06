const { withProjectBuildGradle } = require('expo/config-plugins');

const repository = 'https://repository.map.naver.com/archive/maven';
function addNaverRepository(contents) {
  if (contents.includes(repository)) return contents;
  return `${contents}\nallprojects {\n  repositories {\n    maven { url '${repository}' }\n  }\n}\n`;
}

module.exports = config => withProjectBuildGradle(config, mod => {
  mod.modResults.contents = addNaverRepository(mod.modResults.contents);
  return mod;
});
module.exports.addNaverRepository = addNaverRepository;
