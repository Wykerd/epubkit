import {
    ZipReader,
    Reader,
    Entry,
    TextWriter,
    BlobWriter,
    Uint8ArrayWriter
} from '@zip.js/zip.js'
import { PackageDocument } from './opf';

function generateUniqueURL() {
    // The origin [url] of the container root URL is unique for each user-specific instance of an EPUB publication in a reading system.
    return `http://${crypto.randomUUID()}.local`
}

class OCFAbstractContainer {
    container_root_url: string;

    constructor() {
        // Reading systems MUST assign a URL [url] to the root directory of the OCF abstract container.
        this.container_root_url = generateUniqueURL();
    }

    parseURL(url: string) {
        return new URL(url, this.container_root_url);
    }
}

export class OCFZip extends OCFAbstractContainer {
    reader: ZipReader<unknown>;
    dirtree: Record<string, Entry> = {};

    constructor (zipReader: Reader<unknown>) {
        super();
        this.reader = new ZipReader(zipReader);
    }

    // builds the directory tree of the container
    async load() {
        const entries = await this.reader.getEntries();

        for (const entry of entries) {
            const url = this.parseURL(entry.filename);
            this.dirtree[url.pathname] = entry;
        }
    }

    async unload() {
        await this.reader.close();
    }

    async getPackageDocument() {
        // A reading system MUST, by default, use the package document referenced the from first rootfile element [epub-33] to render the EPUB publication.
        const rootfile = this.dirtree['/META-INF/container.xml'];

        if (!rootfile)
            throw new Error('EPUB missing META-INF/container.xml');

        if (rootfile.directory)
            throw new Error('Unexpected directory entry in META-INF/container.xml');

        if (!rootfile.getData)
            throw new Error('Missing getData method in META-INF/container.xml');

        const containerWriter = new TextWriter();

        const xmlContainer = await rootfile.getData(containerWriter);

        const parser = new DOMParser();

        const containerDoc = parser.parseFromString(xmlContainer, 'application/xml');

        const rootfileElement = containerDoc.querySelector('rootfile');

        if (!rootfileElement)
            throw new Error('Missing rootfile element in META-INF/container.xml');

        const rootfileFullPath = rootfileElement.getAttribute('full-path');
        if (!rootfileFullPath)
            throw new Error('Missing full-path attribute in META-INF/container.xml');

        const rootfileMediaType = rootfileElement.getAttribute('media-type');
        if (rootfileMediaType !== 'application/oebps-package+xml')
            throw new Error('Unexpected media-type in META-INF/container.xml');

        const resolvedRootFileURL = this.parseURL(rootfileFullPath);

        const packageDocument = this.dirtree[resolvedRootFileURL.pathname];
        if (!packageDocument)
            throw new Error('Missing package document');

        if (packageDocument.directory)
            throw new Error('Unexpected directory entry in package document');

        if (!packageDocument.getData)
            throw new Error('Missing getData method in package document');

        const packageWriter = new TextWriter();

        const xmlPackage = await packageDocument.getData(packageWriter);

        const packageDoc = parser.parseFromString(xmlPackage, 'application/xml');

        return new PackageDocument(packageDoc, this, resolvedRootFileURL);
    }

    getBlob(path: string) {
        const entry = this.dirtree[path];

        if (!entry)
            throw new Error('Missing entry');

        if (entry.directory)
            throw new Error('Unexpected directory entry');

        if (!entry.getData)
            throw new Error('Missing getData method');

        return entry.getData(new BlobWriter());
    }

    getUint8Array(path: string) {
        const entry = this.dirtree[path];

        if (!entry)
            throw new Error('Missing entry');

        if (entry.directory)
            throw new Error('Unexpected directory entry');

        if (!entry.getData)
            throw new Error('Missing getData method');

        return entry.getData(new Uint8ArrayWriter());
    }
}