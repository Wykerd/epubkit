import { PackageDocument } from "./opf";
import { Resource } from "./resource";

export interface ComputedRenditionProperties {

}

export class SpineRendition {
    constructor(public opf: PackageDocument) {

    }

    async renderTo(parent: HTMLElement) {
        console.log('Rendering spine to parent...');

        // prepare the parent container
        parent.style.overflow = 'hidden';
        parent.style.display = 'flex';
        parent.style.flexDirection = 'row';
        parent.style.gap = '80px';

        const rendition_items: SpineItemRendition[] = await Promise.all(
            this.opf.spine.itemrefs.filter(items => items.linear).map(async itemref => {
                const resource = await this.opf.getResource(itemref.item.href);
                const item = new SpineItemRendition(resource);
                return item;
            })
        );

        console.log(rendition_items);

        const cleanup_hooks: (() => void)[] = [];

        for (const item of rendition_items) {
            console.log(item);
            const detach = item.attachTo(parent);
            cleanup_hooks.push(detach);
        }

        // wait for all to load
        await Promise.all(rendition_items.map(item => item.load()));
    }
}

export class SpineItemRendition {
    frame: HTMLIFrameElement;
    #frameLoaded: Promise<void>;
    
    constructor(public resource: Resource) {
        this.frame = document.createElement('iframe');
        this.#frameLoaded = new Promise<void>((resolve, reject) => {
            this.frame.onload = () => resolve();
            this.frame.onerror = reject;
        });
    }

    async load() {
        await this.#frameLoaded;

        this.frame.style.flexGrow = '0';
        this.frame.style.flexShrink = '0';

        if (this.resource.resource_type !== 'html')
            // TODO: add support for SVG resource renditions
            throw new Error('Unsupported resource type. Work in progress.');

        const frameDoc = this.frame.contentDocument || this.frame.contentWindow?.document;

        if (!frameDoc)
            throw new Error('Failed to access iframe document');

        frameDoc.open();
        frameDoc.write(this.resource.getSerialized());
        frameDoc.close();
    }

    recomputeLayout(parentWidth: number, parentHeight: number) {
        console.log(`Recomputing layout for ${parentWidth}x${parentHeight}...`);
        const useableWidth = parentWidth;
        const useableHeight = parentHeight;
        this.frame.style.height = `${useableHeight}px`;
        this.frame.style.width = '100%';

        const frameDoc = this.frame.contentDocument || this.frame.contentWindow?.document;

        if (!frameDoc)
            throw new Error('Failed to access iframe document');

        const frameBody = frameDoc.body;

        const columnGap = 80;
        const columnWidth = (useableWidth / 2) - (columnGap / 2);

        console.log(`Column width: ${columnWidth}, column gap: ${columnGap}`);

        frameBody.style.setProperty('margin', `0px`, 'important');
        frameBody.style.columnGap = columnGap + "px";
        frameBody.style.columnFill = "auto";
        frameBody.style.columnWidth = columnWidth + "px";
        frameBody.style.height = "100vh";
        frameBody.style.width = columnWidth + "px";

        this.frame.style.removeProperty('width');
        // we need to wait for the value to be computed
        requestAnimationFrame(() => {
            console.log(`Desiring width: ${frameDoc.documentElement.scrollWidth}px`);
            this.frame.style.width = `${frameDoc.documentElement.scrollWidth}px`;
            this.frame.style.minWidth = `${columnWidth}px`;
        })

        // console.log(`Pages: ${pages}`);
    }

    attachTo(parent: HTMLElement) {
        this.frame.style.border = 'none';
        parent.appendChild(this.frame);

        this.recomputeLayout(
            parent.clientWidth,
            parent.clientHeight
        );
        
        const resizeObserver = new ResizeObserver(() => {
            this.recomputeLayout(
                parent.clientWidth,
                parent.clientHeight
            );
        });

        resizeObserver.observe(parent);

        return () => {
            resizeObserver.disconnect();
            parent.removeChild(this.frame);
        }
    }


}
