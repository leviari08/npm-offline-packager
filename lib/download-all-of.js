const pacote = require('pacote');
const { resolveDependencies, downloadPackages } = require('./fetch-packages');

const VALID_VERSION_REGEX = new RegExp(/^\d+\.\d+\.\d+$/);

async function downloadAllVersionsOf(packageName) {
    const stableVersions = await pacote.packument(packageName)
        .then(res => Object.keys(res.versions).filter(v => v.match(VALID_VERSION_REGEX)))

    const allPackagesToDownload = await Promise.all(
        stableVersions.map(version => resolveDependencies({dependencies: {[packageName]: version}}, {}))
    ).then(res => {
        const allPackages = res.flat();
        // uniq packages by name and version
        const uniqPackages = Object.values(Object.fromEntries(allPackages.map(p => [p.name + '@' + p.version, p])))
        return uniqPackages;
    })

    await downloadPackages(allPackagesToDownload, {destFolder: 'packages'});
}

module.exports = {
    downloadAllVersionsOf
}