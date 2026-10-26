<?php

$headerTemplate = resolveTemplateInclude($frontmatter['header'] ?? getConf('HEADER') ?? 'templates/header.php');
$footerTemplate = resolveTemplateInclude($frontmatter['footer'] ?? getConf('FOOTER') ?? 'templates/footer.php');

$leftBarShow = $frontmatter['leftBarShow'] ?? true;

?><!DOCTYPE HTML>
<html lang="en" class="<?=escapeHtml(getConf('DEFAULT_THEME') ?: 'theme-default');?>">
<head>
	$if(noprefix)$
	<title>$if(pagetitle)$${pagetitle}$else$${title}$endif$</title>
	$else$
	$if(title-prefix)$
	<title>$if(title-prefix)$${title-prefix} | $endif$$if(pagetitle)$${pagetitle}$else$${title}$endif$</title>
	$else$
	<title>$if(pagetitle)$${pagetitle}$else$${title}$endif$</title>
	$endif$
	$endif$
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<meta name="smgen-base-url" content="<?=escapeHtml(getConf('BASE_URL'));?>" />
$for(author)$
	<meta name="author" content="$author.name$" />
$endfor$
$if(date-meta)$
	<meta name="dcterms.date" content="$date-meta$" />
$endif$
$if(keywords)$
	<meta name="keywords" content="$for(keywords)$$keywords$$sep$, $endfor$" />
$endif$
$if(description-meta)$
	<meta name="description" content="$description-meta$" />
$endif$
$if(canonical)$
	<link rel="canonical" href="$canonical$" />
$endif$
	<meta name="title" content="$if(pagetitle)$${pagetitle}$else$${title}$endif$">
<?php renderJsonLd($frontmatter, $pageFile); ?>
	<link rel="icon" type="image/png" sizes="32x32" href="<?=escapeHtml(resolveAssetUrl('/favicon-32.png'))?>">
	<link rel="sitemap" href="<?=escapeHtml(resolveAssetUrl('/sitemap.xml'))?>" />
<?php if(llmsEnabled()): ?>
	<link rel="describedby" type="text/markdown" href="<?=escapeHtml(resolveAssetUrl('/llms.txt'))?>" />
<?php endif; ?>
<?php foreach(rssFeedDefinitions() as $rssFeed): ?>
	<link rel="alternate" type="application/rss+xml" title="<?=escapeHtml($rssFeed['title']);?>" href="<?=escapeHtml(resolveAssetUrl($rssFeed['path']));?>" />
<?php endforeach; ?>
<?php if(staticAssetExists('/logo.svg')): ?>
	<link rel="preload" href="<?=escapeHtml(resolveAssetUrl('/logo.svg'))?>" as="image" type="image/svg">
<?php endif; ?>
	<script>(function(d){try{var v=sessionStorage.getItem('current-theme-variant');if(!v)v=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';d.classList.add(v)}catch(e){d.classList.add('dark')}})(document.documentElement)</script>
	<style>
		$styles.html()$
	</style>
$for(css)$
	<link rel="stylesheet" href="${css}" />
$endfor$
	<style>
$for(header-includes)$
	$header-includes$
$endfor$
	</style>
$if(math)$
	$math$
$endif$
<?php if(getConf('SCRIPTS')) foreach(getConf('SCRIPTS') as $javascript):?>
	<script src="<?=escapeHtml(resolveAssetUrl($javascript))?>"></script>
<?php endforeach; ?>
<?php if(getConf('DEFER_SCRIPTS')) foreach(getConf('DEFER_SCRIPTS') as $javascript):?>
	<script defer src="<?=escapeHtml(resolveAssetUrl($javascript))?>"></script>
<?php endforeach; ?>
<?php if(getConf('INLINE_SCRIPTS')) foreach(getConf('INLINE_SCRIPTS') as $javascriptFile):?>
	<script><?=file_get_contents($javascriptFile);?></script>
<?php endforeach; ?>
</head>
<body>
	<?php include $headerTemplate; ?>
	<section class = "below-fold">
		<div class = "page-rule row">
			<?php if($leftBarShow): ?>
				<nav class = "main"><?php renderNavBar(); ?></nav>
			<?php endif; ?>
			<div class = "page-content">
				<article $if(itemtype)$ itemscope itemtype = "https://${itemtype}" $endif$>
				$for(microdata/pairs)$
				<meta itemprop = "${microdata.key}" content = "${microdata.value}" />
				$endfor$
				$body$
				</article>
				$if(toc)$
				<nav class = "table-of-contents">
					<span class = "wide-only">on this page:</span>
					${toc}
					<span class = "wide-only"><a href = "#">top</a></span>
				</nav>
				$endif$
			</div>
		</div>
	</section>
	<?php include $footerTemplate; ?>
<?php if(getConf('BODY_SCRIPTS')) foreach(getConf('BODY_SCRIPTS') as $javascript):?>
	<script src="<?=escapeHtml(resolveAssetUrl($javascript))?>"></script>
<?php endforeach; ?>
<?php if(getConf('INLINE_BODY_SCRIPTS')) foreach(getConf('INLINE_BODY_SCRIPTS') as $javascriptFile):?>
	<script><?=file_get_contents($javascriptFile);?></script>
<?php endforeach; ?>
</body>
</html>
