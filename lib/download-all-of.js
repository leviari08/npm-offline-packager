const pacote = require('pacote');
const { resolveDependencies, downloadPackages } = require('./fetch-packages');

const VALID_VERSION_REGEX = new RegExp(/^\d+\.\d+\.\d+$/);

async function downloadAllVersionsOf(packageName, from=new Date('2023')) {
    console.log(`Downloading all versions of ${packageName} from ${from.toDateString()}`)
    const stableVersions = await pacote.packument(packageName, { fullMetadata: true })
        .then(res => Object.keys(res.versions).filter(v => v.match(VALID_VERSION_REGEX) && new Date(res.time[v]) > from));

    console.log(`Found ${stableVersions.length} stable version of ${packageName}`);

    const allPackagesToDownload = await Promise.all(
        stableVersions.map(version => resolveDependencies({dependencies: {[packageName]: version}}, {}))
    ).then(res => {
        const allPackages = res.flat();
        // uniq packages by name and version
        const uniqPackages = Object.values(Object.fromEntries(allPackages.map(p => [p.name + '@' + p.version, p])))
        return uniqPackages;
    });

    console.log(`Finished fetching packages - ${allPackagesToDownload.length} found - start downloading`);

    await downloadPackages(allPackagesToDownload, {destFolder: 'packages', useCache: false});
}

module.exports = {
    downloadAllVersionsOf
}