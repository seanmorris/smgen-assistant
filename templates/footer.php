<footer class="footer">
	<div class = "page-rule row">
		<p>&copy; <?=date('Y');?> <?=escapeHtml(getConf('ORGANIZATION') ?: 'Organization Name');?></p>
		<div class="footer-links">
			<a href="<?=escapeHtml(resolveAssetUrl('/privacy-and-licensing.html'))?>">Privacy and licensing</a>
			<a href="https://github.com/seanmorris/smgen-assistant" rel="noopener noreferrer">Source</a>
		</div>
	</div>
</footer>
