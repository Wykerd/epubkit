import { OCFZip } from "./ocf";
import { createResourceFromItem } from "./resource";

const VALID_TEXT_DIRS = ['ltr', 'rtl', 'auto'] as const;
export type TextDir = typeof VALID_TEXT_DIRS[number];
const DEFAULT_TEXT_DIR: TextDir = 'auto';

export interface TextRun {
    text: string;
    dir: TextDir;
    lang?: string;
    toString(): string;
}

export class TextRun implements TextRun {
    lang?: string; 

    constructor(text: string, dir: TextDir = DEFAULT_TEXT_DIR) {
        this.text = text;
        this.dir = dir;
    }

    toString() {
        return this.text;
    }

    static fromElement(element: Element, default_lang?: string): TextRun {
        const dir = element.getAttribute('dir');
        const sanitizedDir = dir && VALID_TEXT_DIRS.includes(dir as TextDir) ? dir as TextDir : DEFAULT_TEXT_DIR;

        const run = new TextRun(element.textContent || '', sanitizedDir);

        const lang = element.getAttribute('xml:lang') || default_lang;
        if (lang)
            run.lang = lang;

        return run;
    }
}

export interface PackageMetadata {
    element: Element;
    identifiers: string[];
    titles: TextRun[];
    languages: string[];
    /// meta property="dcterms:modified"
    modified?: Date;

    // dublin core optional elements
    contributors?: TextRun[];
    coverages?: TextRun[];
    creators?: TextRun[];
    dates?: string[];
    descriptions?: TextRun[];
    formats?: string[];
    publishers?: TextRun[];
    relations?: TextRun[];
    rights?: TextRun[];
    sources?: string[];
    subjects?: TextRun[];
    types?: string[];
}

export interface PackageItem {
    /// The fallback attribute's IDREF [xml] value MUST resolve to another item in the manifest.
    fallback?: string;
    href: string;
    mime: string;
    /// IDREF [xml] that identifies the media overlay document for the resource described by this item
    overlay?: string; 
    
    properties: string[];

    getContentBlob(): Promise<Blob>;
    getContentBuffer(): Promise<Uint8Array>;
}

export interface PackageManifest {
    items: PackageItem[];
    items_by_id: Record<string, PackageItem>;
}

export interface ItemRef {
    id?: string;
    idref: string;
    item: PackageItem;
    linear?: boolean;
    properties: string[];
}

export const VALID_PAGE_PROGRESSION_DIRS = ['ltr', 'rtl', 'default'] as const;
export type PageProgressionDir = typeof VALID_PAGE_PROGRESSION_DIRS[number];
const DEFAULT_PAGE_PROGRESSION_DIR: PageProgressionDir = 'default';

export interface PackageSpine {
    id?: string;
    page_progression: PageProgressionDir;
    itemrefs: ItemRef[];
}

export class Collection {

}

const RENDITION_LAYOUT_VALUES = ['pre-paginated', 'reflowable'] as const;
type RenditionLayout = typeof RENDITION_LAYOUT_VALUES[number];

const RENDITION_ORIENTATION_VALUES = ['auto', 'landscape', 'portrait'] as const;
type RenditionOrientation = typeof RENDITION_ORIENTATION_VALUES[number];

const RENDITION_SPREAD_VALUES = ['none', 'landscape', 'portrait', 'both', 'auto'] as const;
type RenditionSpread = typeof RENDITION_SPREAD_VALUES[number];

const RENDITION_PAGE_SPREAD_VALUES = ['center', 'left', 'right'] as const;
type RenditionPageSpread = typeof RENDITION_PAGE_SPREAD_VALUES[number];

const RENDITION_FLOW_VALUES = ['auto', 'paginated', 'scrolled-continuous', 'scrolled-doc'] as const;
type RenditionFlow = typeof RENDITION_FLOW_VALUES[number];

export interface PackageRendition {
    layout: RenditionLayout;
    orientation: RenditionOrientation;
    spread: RenditionSpread;
    page_spread: RenditionPageSpread;
    flow: RenditionFlow;

    align_x_center: boolean;
}

export class PackageDocument {
    base_url: string;

    dir: TextDir = DEFAULT_TEXT_DIR;
    id?: string;
    prefix?: string;
    lang?: string;
    uid: string;
    primary_identifier: string;
    version: string;

    nav_item?: string;
    cover_item?: string;
    toc_item?: string; // LEGACY: nav_item is what EPUB 3 uses but EPUB 2 uses toc

    rendition: PackageRendition;

    metadata: PackageMetadata;
    manifest: PackageManifest;
    spine: PackageSpine;

    #cached_resources: Record<string, ReturnType<typeof createResourceFromItem>> = {};

    constructor(public document: Document, public ocf: OCFZip, public package_url: URL) {
        this.base_url = new URL('.', package_url).href;

        if (document.documentElement.tagName !== 'package')
            throw new Error('Invalid package document');

        const uid = document.documentElement.getAttribute('unique-identifier');
        if (!uid)
            throw new Error('Missing unique-identifier attribute in package document');

        this.uid = uid;

        const primary_identifier = document.documentElement.querySelector(`metadata > [id="${uid}"]`);
        if (!primary_identifier)
            throw new Error('Missing primary identifier in package document');
        if (primary_identifier.tagName !== 'dc:identifier')
            throw new Error('Primary identifier must be a dc:identifier element');

        this.primary_identifier = primary_identifier.textContent || '';

        const version = document.documentElement.getAttribute('version');

        if (!version)
            throw new Error('Missing version attribute in package document');

        this.version = version;

        // optional attributes
        const dir = document.documentElement.getAttribute('dir');
        if (dir && VALID_TEXT_DIRS.includes(dir as TextDir))
            this.dir = dir as TextDir;
        this.id = document.documentElement.getAttribute('id') || undefined;
        this.prefix = document.documentElement.getAttribute('prefix') || undefined;
        this.lang = document.documentElement.getAttribute('xml:lang') || undefined;

        // must have exactly one metadata element - we don't throw if there are more to be lenient
        const metadata = document.documentElement.querySelector('metadata');
        if (!metadata)
            throw new Error('Missing metadata element in package document');

        this.metadata = this.#processMetadata(metadata);

        // must have exactly one manifest element - we don't throw if there are more to be lenient
        const manifest = document.documentElement.querySelector('manifest');
        if (!manifest)
            throw new Error('Missing manifest element in package document');

        this.manifest = this.#processManifest(manifest);

        // must have exactly one spine element - we don't throw if there are more to be lenient
        const spine = document.documentElement.querySelector('spine');
        if (!spine)
            throw new Error('Missing spine element in package document');

        this.spine = this.#processSpine(spine);

        // optionals
        // TODO: should we implement this?
        // LEGACY: const guide = document.documentElement.querySelector('guide');
        // DEPRECATED: const bindings = document.documentElement.querySelector('bindings');
        // TODO: const collection = document.documentElement.querySelector('collection');

        this.rendition = this.#processRendition(metadata);
    }

    parseURL(url: string) {
        return new URL(url, this.base_url);
    }

    getResource(url: string, base_url = this.base_url) {
        const resolved_url = new URL(url, base_url);

        if (resolved_url.origin !== this.package_url.origin)
            throw new Error('Resource origin does not match package origin');

        if (this.#cached_resources[resolved_url.pathname] !== undefined)
            return this.#cached_resources[resolved_url.pathname];

        const item = this.manifest.items.find(item => {
            return resolved_url.href === this.parseURL(item.href).href;
        });

        if (!item)
            throw new Error(`Resource ${JSON.stringify(url)} not found in manifest`);

        this.#cached_resources[resolved_url.pathname] = createResourceFromItem(item, this, resolved_url.href);

        return this.#cached_resources[resolved_url.pathname];
    }

    #processRendition(metadata: Element): PackageRendition {
        const rendition: PackageRendition = {
            layout: 'reflowable',
            orientation: 'auto',
            spread: 'auto',
            page_spread: 'center',
            flow: 'auto',
            align_x_center: false
        };

        const rendition_layout_meta = metadata.querySelector('meta[property="rendition:layout"]');

        if (rendition_layout_meta) {
            const val = rendition_layout_meta.textContent?.trim();
            if (val && RENDITION_LAYOUT_VALUES.includes(val as RenditionLayout))
                rendition.layout = val as RenditionLayout;
        }

        const rendition_orientation_meta = metadata.querySelector('meta[property="rendition:orientation"]');
        if (rendition_orientation_meta) {
            const val = rendition_orientation_meta.textContent?.trim();
            if (val && RENDITION_ORIENTATION_VALUES.includes(val as RenditionOrientation))
                rendition.orientation = val as RenditionOrientation;
        }

        const rendition_spread_meta = metadata.querySelector('meta[property="rendition:spread"]');

        if (rendition_spread_meta) {
            const val = rendition_spread_meta.textContent?.trim();
            if (val && RENDITION_SPREAD_VALUES.includes(val as RenditionSpread))
                rendition.spread = val as RenditionSpread;
        }

        // page-spread is per itemref

        const rendition_flow_meta = metadata.querySelector('meta[property="rendition:flow"]');
        if (rendition_flow_meta) {
            const val = rendition_flow_meta.textContent?.trim();
            if (val && RENDITION_FLOW_VALUES.includes(val as RenditionFlow))
                rendition.flow = val as RenditionFlow;
        }

        // align-x-center is per itemref

        return rendition;
    };


    #processMetadata(metadata: Element): PackageMetadata {
        const packageMetadata: PackageMetadata = {
            element: metadata,
            identifiers: [],
            titles: [],
            languages: []
        };

        const identifiers = metadata.getElementsByTagName('dc:identifier');
        const titles = metadata.getElementsByTagName('dc:title');
        const languages = metadata.getElementsByTagName('dc:language');

        // we need at least one of each
        if (identifiers.length === 0)
            throw new Error('Missing dc:identifier element in metadata');
        if (titles.length === 0)
            throw new Error('Missing dc:title element in metadata');
        if (languages.length === 0)
            throw new Error('Missing dc:language element in metadata');

        // there should also be a dcterms:modified meta element, but we're not doing that now.
        const modified = metadata.querySelector('meta[property="dcterms:modified"]');
        if (modified) {
            const modifiedDate = modified.textContent;
            if (modifiedDate)
                packageMetadata.modified = new Date(modifiedDate.trim());
        }

        for (const identifier of identifiers) {
            const id = identifier.textContent?.trim();
            if (id)
                packageMetadata.identifiers.push(id);
        }

        for (const language of languages) {
            const lang = language.textContent?.trim();
            if (lang)
                packageMetadata.languages.push(lang);
        }

        // treat first language as the default language
        if (packageMetadata.languages.length > 0 && !this.lang)
            this.lang = packageMetadata.languages[0];

        for (const title of titles) {
            const text = title.textContent?.trim();
            if (text) {
                const run = TextRun.fromElement(title, this.lang);

                packageMetadata.titles.push(run);
            }
        }

        // dublin core optionals
        const contributors = metadata.getElementsByTagName('dc:contributor');
        const coverages = metadata.getElementsByTagName('dc:coverage');
        const creators = metadata.getElementsByTagName('dc:creator');
        const dates = metadata.getElementsByTagName('dc:date');
        const descriptions = metadata.getElementsByTagName('dc:description');
        const formats = metadata.getElementsByTagName('dc:format');
        const publishers = metadata.getElementsByTagName('dc:publisher');
        const relations = metadata.getElementsByTagName('dc:relation');
        const rights = metadata.getElementsByTagName('dc:rights');
        const sources = metadata.getElementsByTagName('dc:source');
        const subjects = metadata.getElementsByTagName('dc:subject');
        const types = metadata.getElementsByTagName('dc:type');

        for (const contributor of contributors) {
            const text = contributor.textContent?.trim();
            if (text) {
                const run = TextRun.fromElement(contributor, this.lang);

                if (!packageMetadata.contributors)
                    packageMetadata.contributors = [];
                packageMetadata.contributors.push(run);
            }
        }

        for (const coverage of coverages) {
            const text = coverage.textContent?.trim();
            if (text) {
                const run = TextRun.fromElement(coverage, this.lang);

                if (!packageMetadata.coverages)
                    packageMetadata.coverages = [];
                packageMetadata.coverages.push(run);
            }
        }

        for (const creator of creators) {
            const text = creator.textContent?.trim();
            if (text) {
                const run = TextRun.fromElement(creator, this.lang);

                if (!packageMetadata.creators)
                    packageMetadata.creators = [];
                packageMetadata.creators.push(run);
            }
        }

        for (const date of dates) {
            const text = date.textContent?.trim();
            if (text) {
                if (!packageMetadata.dates)
                    packageMetadata.dates = [];
                packageMetadata.dates.push(text);
            }
        }

        for (const description of descriptions) {
            const text = description.textContent?.trim();
            if (text) {
                const run = TextRun.fromElement(description, this.lang);

                if (!packageMetadata.descriptions)
                    packageMetadata.descriptions = [];
                packageMetadata.descriptions.push(run);
            }
        }

        for (const format of formats) {
            const text = format.textContent?.trim();
            if (text) {
                if (!packageMetadata.formats)
                    packageMetadata.formats = [];
                packageMetadata.formats.push(text);
            }
        }

        for (const publisher of publishers) {
            const text = publisher.textContent?.trim();
            if (text) {
                const run = TextRun.fromElement(publisher, this.lang);

                if (!packageMetadata.publishers)
                    packageMetadata.publishers = [];
                packageMetadata.publishers.push(run);
            }
        }

        for (const relation of relations) {
            const text = relation.textContent?.trim();
            if (text) {
                const run = TextRun.fromElement(relation, this.lang);

                if (!packageMetadata.relations)
                    packageMetadata.relations = [];
                packageMetadata.relations.push(run);
            }
        }

        for (const right of rights) {
            const text = right.textContent?.trim();
            if (text) {
                const run = TextRun.fromElement(right, this.lang);

                if (!packageMetadata.rights)
                    packageMetadata.rights = [];
                packageMetadata.rights.push(run);
            }
        }

        for (const source of sources) {
            const text = source.textContent?.trim();
            if (text) {
                if (!packageMetadata.sources)
                    packageMetadata.sources = [];
                packageMetadata.sources.push(text);
            }
        }

        for (const subject of subjects) {
            const text = subject.textContent?.trim();
            if (text) {
                const run = TextRun.fromElement(subject, this.lang);

                if (!packageMetadata.subjects)
                    packageMetadata.subjects = [];
                packageMetadata.subjects.push(run);
            }
        }

        for (const type of types) {
            const text = type.textContent?.trim();
            if (text) {
                if (!packageMetadata.types)
                    packageMetadata.types = [];
                packageMetadata.types.push(text);
            }
        }

        return packageMetadata;
    }

    #processManifest(manifest: Element): PackageManifest {
        const packageManifest: PackageManifest = {
            items: [],
            items_by_id: {}
        }

        const items = manifest.getElementsByTagName('item');

        for (const item of items) {
            const href = item.getAttribute('href');
            if (!href)
                throw new Error('Missing href attribute in manifest item');

            const mime = item.getAttribute('media-type');
            if (!mime)
                throw new Error('Missing media-type attribute in manifest item');

            const properties = item.getAttribute('properties')?.split(' ') || [];

            const id = item.getAttribute('id');
            if (!id)
                throw new Error('Missing id attribute in manifest item');

            // optional
            const fallback = item.getAttribute('fallback') ?? undefined;
            const overlay = item.getAttribute('media-overlay') ?? undefined;

            const resolved_path = this.parseURL(href);
            if (resolved_path.origin !== this.package_url.origin)
                // TODO: should this throw?
                throw new Error('Resource origin does not match package origin');

            const packageItem: PackageItem = {
                href,
                mime,
                properties,
                fallback,
                overlay,
                getContentBlob: () => {
                    return this.ocf.getBlob(resolved_path.pathname);
                },
                getContentBuffer: () => {
                    return this.ocf.getUint8Array(resolved_path.pathname);
                }
            };

            packageManifest.items.push(packageItem);
            packageManifest.items_by_id[id] = packageItem;

            // if properties include 'nav', then this is the nav document
            if (properties.includes('nav')) {
                this.nav_item = id;
            }

            // if properties include 'cover-image', then this is the cover image
            if (properties.includes('cover-image')) {
                this.cover_item = id;
            }
        }

        return packageManifest;
    }

    #processSpine(spine: Element): PackageSpine {
        const packageSpine: PackageSpine = {
            page_progression: DEFAULT_PAGE_PROGRESSION_DIR,
            itemrefs: []
        };
        const id = spine.getAttribute('id');
        if (id)
            packageSpine.id = id;
        const page_progression = spine.getAttribute('page-progression-direction');
        if (page_progression && VALID_PAGE_PROGRESSION_DIRS.includes(page_progression as PageProgressionDir))
            packageSpine.page_progression = page_progression as PageProgressionDir;

        const toc = spine.getAttribute('toc');
        if (toc) {
            const item = this.manifest.items_by_id[toc];
            if (!item)
                throw new Error('Invalid toc attribute in spine. No matching item in manifest.');
            this.toc_item = toc;
        }

        const itemrefs = spine.getElementsByTagName('itemref');
        // must have at least one itemref
        if (itemrefs.length === 0)
            throw new Error('Missing itemref elements in spine');

        let has_linear = false;
        for (const itemref of itemrefs) {
            const idref = itemref.getAttribute('idref');
            if (!idref)
                throw new Error('Missing idref attribute in itemref');

            // itemref element MUST reference the ID [xml] of an item in the manifest
            const item = this.manifest.items_by_id[idref];
            if (!item)
                throw new Error(`Invalid idref attribute in itemref: ${idref}. No matching item in manifest.`);

            // Each referenced manifest item MUST be either a) an EPUB content document or b) a foreign content document that includes an EPUB content document in its manifest fallback chain.
            let is_valid = false;
            let current_item = item;
            while (current_item) {
                // conforms to either the XHTML or SVG content document definitions.
                if ([
                    'application/xhtml+xml',
                    'application/svg+xml',
                    'image/svg+xml',
                    'application/svg',
                    'image/svg',
                    'application/xhtml',
                    'text/html',
                ].includes(current_item.mime)) {
                    is_valid = true;
                    break;
                }

                // now look up in the fallback chain
                if (current_item.fallback) {
                    // TODO: we MUST check for circular references
                    current_item = this.manifest.items_by_id[current_item.fallback];
                } else {
                    break;
                }
            }

            if (!is_valid)
                throw new Error(`Invalid idref attribute in itemref: ${idref}. No reference to EPUB content document in manifest chain.`);

            // A linear itemref element is one whose linear attribute value is explicitly set to "yes" or that omits the attribute — reading systems will assume the value "yes" for itemref elements without the attribute. The spine MUST contain at least one linear itemref element.
            const linear = itemref.getAttribute('linear');
            const linear_value = linear === 'no' ? false : true;
            if (linear_value)
                has_linear = true;

            const properties = itemref.getAttribute('properties')?.split(' ') || [];

            packageSpine.itemrefs.push({
                idref,
                item,
                linear: linear_value,
                properties
            });
        }

        // must have at least one linear itemref
        if (!has_linear)
            throw new Error('Missing linear itemref in spine. EPUB requires at least one linear itemref.');

        return packageSpine;
    }
}
