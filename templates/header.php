<section class = "heading">
	<div class = "page-rule">
		<header>
			<div class = "row wide">
				<nav>
					<a class = "logo" href = "<?=escapeHtml(resolveAssetUrl('/'))?>">
						<?php if(staticAssetExists('/logo.svg')): ?>
						<img src="<?=escapeHtml(resolveAssetUrl('/logo.svg'))?>" class="logo-image" alt="" width="216" height="210">
						<?php endif; ?>
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
						<a class="smgen-link" href="https://seanmorris.github.io/smgen/" aria-label="SMGen documentation" title="SMGen documentation">SMGen</a>
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
