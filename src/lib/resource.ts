import { PackageDocument, PackageItem } from "./opf";


export type Resource = HTMLResource | CSSResource | BinaryResource;

export async function createResourceFromItem(item: PackageItem, opf: PackageDocument, base_url: string): Promise<Resource> {
    const is_html = [
        'text/html',
        'application/xhtml',
        'application/xhtml+xml'
    ].includes(item.mime.trim().toLowerCase());

    const is_css = [
        'text/css'
    ].includes(item.mime.trim().toLowerCase());
    const item_content = await item.getContentBuffer();

    if (is_html) {
        return HTMLResource.create(item_content, opf, base_url);
    }

    if (is_css) {
        return CSSResource.create(item_content, opf, base_url);
    }

    return new BinaryResource(item_content);
}

export abstract class CommonResource {
    object_url?: string;

    abstract getBlob(): Blob;
    
    getURL(): string {
        if (this.object_url) return this.object_url;
        this.object_url = URL.createObjectURL(this.getBlob());
        return this.object_url;
    }

    clean() {
        if (this.object_url) URL.revokeObjectURL(this.object_url);
    }
}

export class HTMLResource extends CommonResource {
    resource_type: 'html' = 'html';
    blob?: Blob;

    constructor(public doc: Document, public resources: Resource[]) {
        super();
    }
    
    getSerialized() {
        const serializer = new XMLSerializer();
        return serializer.serializeToString(this.doc);
    }

    getBlob() {
        if (this.blob) return this.blob;

        const content = this.getSerialized();
        const blob = new Blob([content], { type: 'application/xhtml+xml' });
        this.blob = blob;
        return blob;
    }

    static async create(content: Uint8Array, opf: PackageDocument, base_url: string) {
        const content_str = new TextDecoder().decode(content);
        const parser = new DOMParser();
        const doc = parser.parseFromString(content_str, 'application/xhtml+xml');

        const base_origin = new URL(base_url).origin;

        // now we find all the external resources
        // - src attributes in audio, embed, img, input, script, source, track, video
        // - href attributes in script, image, use, link where rel is one of stylesheet, icon, shortcut icon, mask-icon, apple-touch-icon, apple-touch-icon-precomposed, apple-touch-startup-image, manifest, prefetch, preload or when the itemprop attribute is image, logo, screenshot, thumbnailurl, contenturl, downloadurl, duringmedia, embedurl, installurl, layoutimage
        // - xlink:href attributes
        // - srcset attributes of img, source
        // - poster attributes of video
        // - data attributes of object
        // - content attributes of meta with name attribute set to one of msapplication-tileimage, msapplication-square70x70logo, msapplication-square150x150logo, msapplication-wide310x150logo, msapplication-square310x310logo, msapplication-config, twitter:image or when the property attribute is og:image, og:image:url, og:image:secure_url, og:audio, og:audio:secure_url, og:video, og:video:secure_url, vk:image or when the itemprop attribute is image, logo, screenshot, thumbnailurl, contenturl, downloadurl, duringmedia, embedurl, installurl, layoutimage
        // - imagesrcset attributes of link with rel attribute set to stylesheet, icon, shortcut icon, mask-icon, apple-touch-icon, apple-touch-icon-precomposed, apple-touch-startup-image, manifest, prefetch, preload
        const tag_attribute_matchers = [
            { tag: 'audio', attribute: 'src' },
            { tag: 'embed', attribute: 'src' },
            { tag: 'img', attribute: 'src' },
            { tag: 'input', attribute: 'src' },
            { tag: 'script', attribute: 'src' },
            { tag: 'source', attribute: 'src' },
            { tag: 'track', attribute: 'src' },
            { tag: 'video', attribute: 'src' },
            { tag: 'script', attribute: 'href' },
            { tag: 'image', attribute: 'href' },
            { tag: 'use', attribute: 'href' },
            { tag: 'link', attribute: 'href', rels: ['stylesheet', 'icon', 'shortcut icon', 'mask-icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'apple-touch-startup-image', 'manifest', 'prefetch', 'preload'] },
            { tag: 'img', attribute: 'srcset' },
            { tag: 'source', attribute: 'srcset' },
            { tag: 'video', attribute: 'poster' },
            { tag: 'object', attribute: 'data' },
            { tag: 'meta', attribute: 'content', names: ['msapplication-tileimage', 'msapplication-square70x70logo', 'msapplication-square150x150logo', 'msapplication-wide310x150logo', 'msapplication-square310x310logo', 'msapplication-config', 'twitter:image'], properties: ['og:image', 'og:image:url', 'og:image:secure_url', 'og:audio', 'og:audio:secure_url', 'og:video', 'og:video:secure_url', 'vk:image'], itemprops: ['image', 'logo', 'screenshot', 'thumbnailurl', 'contenturl', 'downloadurl', 'duringmedia', 'embedurl', 'installurl', 'layoutimage'] },
            { tag: 'link', attribute: 'imagesrcset', rels: ['stylesheet', 'icon', 'shortcut icon', 'mask-icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'apple-touch-startup-image', 'manifest', 'prefetch', 'preload'] }
        ];

        const resources: Resource[] = [];
        
        for (const matcher of tag_attribute_matchers) {
            const candidates = doc.getElementsByTagName(matcher.tag);
            for (const candidate of candidates) {
                const attr = candidate.getAttribute(matcher.attribute);
                const xlinkHref = candidate.getAttribute('xlink:href');
                if (!(attr || xlinkHref)) continue;

                if (matcher.rels) {
                    const rel = candidate.getAttribute('rel')?.trim().toLowerCase();
                    if (!rel) continue;
                    if (!matcher.rels.includes(rel)) continue;
                }

                if (matcher.names) {
                    const name = candidate.getAttribute('name')?.trim().toLowerCase();
                    if (!name) continue;
                    if (!matcher.names.includes(name)) continue;
                }

                if (matcher.properties) {
                    const property = candidate.getAttribute('property')?.trim().toLowerCase();
                    if (!property) continue;
                    if (!matcher.properties.includes(property)) continue;
                }

                if (matcher.itemprops) {
                    const itemprop = candidate.getAttribute('itemprop')?.trim().toLowerCase();
                    if (!itemprop) continue;
                    if (!matcher.itemprops.includes(itemprop)) continue;
                }

                if (attr) {
                    const url = new URL(attr, base_url);
                    if (url.origin !== base_origin) continue; // ignore external resources
                    const item = await opf.getResource(attr, base_url);
                    
                    resources.push(item);

                    // replace the attribute with the new resource URL
                    candidate.setAttribute(matcher.attribute, item.getURL());
                }

                if (xlinkHref) {
                    const url = new URL(xlinkHref, base_url);
                    if (url.origin !== base_origin) continue; // ignore external resources
                    const item = await opf.getResource(xlinkHref, base_url);
                    
                    resources.push(item);

                    // replace the attribute with the new resource URL
                    candidate.setAttribute('xlink:href', await item.getURL());
                }
            }
        }

        return new HTMLResource(doc, resources);
    }
}

export class CSSResource extends CommonResource {
    resource_type: 'css' = 'css';

    constructor(public content: string, public resources: Resource[] = []) {
        super();
    }

    getBlob() {
        return new Blob([this.content], { type: 'text/css' });
    }

    static async create(content: Uint8Array, opf: PackageDocument, base_url: string) {
        let content_str = new TextDecoder().decode(content);

        const base_origin = new URL(base_url).origin;

        const resources: Resource[] = [];

        // find all import statements
        const importRegex = /@import\s+(['"]?)(.*?)\1\s*;/g;
        let match;
        const imports: string[] = [];

        while ((match = importRegex.exec(content_str)) !== null) {
            imports.push(match[2].trim());
        }

        // filter out any starting with url( since it is handled separately
        const filtered_imports = imports.filter(i => !i.startsWith('url('));

        for (const candidate_import of filtered_imports) {
            const url = new URL(candidate_import, base_url);
            if (url.origin !== base_origin) continue; // ignore external resources
            const item = await opf.getResource(candidate_import, base_url);

            // replace the import statement with the new resource URL
            content_str = content_str.replace(candidate_import, item.getURL());
            
            resources.push(item);
        }

        // find all url statements
        const regex = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
        match = undefined;
        const urls = [];

        while ((match = regex.exec(content_str)) !== null) {
            urls.push(match[2]);
        }

        for (const candidate_url of urls) {
            const url = new URL(candidate_url, base_url);
            if (url.origin !== base_origin) continue; // ignore external resources
            const item = await opf.getResource(candidate_url);

            // replace the url statement with the new resource URL
            content_str = content_str.replace(candidate_url, item.getURL());
            
            resources.push(item);
        }

        return new CSSResource(content_str, resources);
    }
}

export class BinaryResource extends CommonResource {
    resource_type: 'binary' = 'binary';
    blob: Blob;

    constructor(content: Uint8Array) {
        super();
        this.blob = new Blob([content]);
    }

    getBlob() {
        return this.blob;
    }
}
