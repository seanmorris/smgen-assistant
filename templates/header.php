<section class = "heading">
	<div class = "page-rule">
		<header>
			<div class = "row wide">
				<nav>
					<a class = "logo" href = "<?=escapeHtml(resolveAssetUrl('/'))?>">
						<span class = "col">
							<span class = "logo-text">
								<?=escapeHtml(getConf('PRODUCT_NAME') ?: 'Product Name');?>
							</span>
							<?php if(getConf('TAGLINE')): ?>
							<span class = "tagline-text"><?=escapeHtml(getConf('TAGLINE') ?: 'Tagline');?></span>
							<?php endif; ?>
						</span>
					</a>
				</nav>
				<div class = "header-fill">
					<div class = "links">
						<a class="github-icon" href="https://github.com/seanmorris/smgen-assistant" aria-label="Source on GitHub" title="Source on GitHub" rel="noopener noreferrer"></a>
						<button type="button" data-toggle-theme-variant aria-label="Toggle color theme" title="Toggle color theme"></button>
					</div>
				</div>
			</div>
		</header>
	</div>
	<?php if($heroHtml??false): ?>
	<div class = "page-rule">
		<?=$heroHtml;?>
	</div>
	<?php endif; ?>
</section>
