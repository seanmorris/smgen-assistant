function resolveLines(...args)
{
	const lines = [];
	for(const arg of args)
	{
		if(typeof arg === 'number')
		{
			lines.push(arg);
		}

		if(typeof arg === 'string' && arg.match(/^\d+$/))
		{
			lines.push(arg);
		}

		if(typeof arg === 'string' && arg.match(/^\d+-\d+$/))
		{
			const [start, end] = arg.split('-').map(Number);
			const range = Array(1 + -start + end).fill(0).map((_, i) => i + start);
			lines.push(...range);
		}
	}

	return lines.map(x => String(-1 + Number(x)));
}

function flicker(element, timeout)
{
	if(element.classList.contains('flickering')) return;
	element.classList.add('flickering');
	setTimeout(() => element.classList.remove('flickering'), timeout);
}

let mousedownNavigationAnchor;
let dispatchingMousedownNavigation = false;

document.addEventListener('click', event => {
	const anchor = event.target.closest?.('a');
	if(dispatchingMousedownNavigation || !anchor || anchor !== mousedownNavigationAnchor) return;

	mousedownNavigationAnchor = null;
	event.preventDefault();
	event.stopImmediatePropagation();
}, true);

document.addEventListener('click', event => {
	let target = event.target;
	let href;

	while(target && target.getAttribute && !href)
	{
		href = target.getAttribute('href');

		if(href)
		{
			const url = new URL(href, location);

			if(url.origin !== window.location.origin)
			{
				window.open(href, '_blank', 'noopener,noreferrer');
				event.preventDefault();
				return;
			}

			if(url.hash)
			{
				const element = document.getElementById(url.hash.substr(1));
				if(element) flicker(element, 200);
			}
		}

		target = target.parentNode;
	}
});

document.addEventListener('mousedown', event => {
	if(event.defaultPrevented || event.button !== 0
		|| event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
	{
		return;
	}

	const anchor = event.target.closest?.('a[href]');
	if(!anchor) return;

	event.preventDefault();
	mousedownNavigationAnchor = anchor;
	dispatchingMousedownNavigation = true;
	try
	{
		anchor.click();
	}
	finally
	{
		dispatchingMousedownNavigation = false;
	}
});

document.addEventListener('mouseup', () => {
	if(!mousedownNavigationAnchor) return;
	const anchor = mousedownNavigationAnchor;
	setTimeout(() => {
		if(mousedownNavigationAnchor === anchor) mousedownNavigationAnchor = null;
	}, 0);
}, true);

window.addEventListener('blur', () => {
	mousedownNavigationAnchor = null;
});

const prefetchedUrls = new Set();
let prefetchTimer;

document.addEventListener('mouseover', event => {
	const anchor = event.target.closest?.('a[href]');
	if(!anchor || anchor.contains(event.relatedTarget)) return;

	clearTimeout(prefetchTimer);
	prefetchTimer = setTimeout(() => {
		const connection = navigator.connection;
		if(connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return;
		if(anchor.target || anchor.hasAttribute('download')) return;

		const url = new URL(anchor.href, location.href);
		if(!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return;
		if(url.pathname === location.pathname && url.search === location.search) return;
		url.hash = '';
		if(prefetchedUrls.has(url.href)) return;

		prefetchedUrls.add(url.href);
		const link = document.createElement('link');
		link.rel = 'prefetch';
		link.href = url.href;
		link.as = 'document';
		document.head.append(link);
	}, 75);
});

document.addEventListener('mouseout', event => {
	const anchor = event.target.closest?.('a[href]');
	if(anchor && !anchor.contains(event.relatedTarget)) clearTimeout(prefetchTimer);
});

document.addEventListener('DOMContentLoaded', () => {
	const button = document.getElementById('burgerButton');

	button && button.addEventListener('click', () => {
		const newValue = button.getAttribute('data-open') === 'false' || button.getAttribute('data-open') === '';
		button.setAttribute('data-open', newValue);
		newValue
			? document.body.classList.add('menu-open')
			: document.body.classList.remove('menu-open');
	});

	const codeBlocks = document.querySelectorAll('div.sourceCode');

	for(const codeBlock of codeBlocks)
	{
		const lines = [...codeBlock.querySelectorAll('pre > code > span')];

		const start = codeBlock.getAttribute('data-startfrom') ?? codeBlock.getAttribute('start');
		if(start)
		{
			codeBlock.style.setProperty('--startFrom', start);
		}

		const highlight = codeBlock.getAttribute('data-highlight');
		if(highlight)
		{
			const numbers = resolveLines(...highlight.split(',').map(n => n.trim()));

			for(const number of numbers)
			{
				if(!lines[number])
				{
					continue;
				}

				lines[number].classList.add('highlight');
			}
		}

		const attributes = codeBlock.getAttributeNames();
		const prefix = 'data-highlight-';

		for(const attribute of attributes)
		{
			if(attribute.substring(0, prefix.length) === prefix)
			{
				const suffix = attribute.substring(prefix.length);
				const lineSelectors = codeBlock.getAttribute(attribute).split(',');

				if(!lineSelectors.length) continue;

				const numbers = resolveLines(...lineSelectors.map(n => n.trim()));

				for(const number of numbers)
				{
					if(!lines[number])
					{
						continue;
					}

					lines[number].classList.add(suffix);
				}
			}
		}
	}
});
