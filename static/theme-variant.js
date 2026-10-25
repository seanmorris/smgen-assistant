document.addEventListener('DOMContentLoaded', () => {
	const de = document.documentElement;
	if(!de.classList.contains('light') && !de.classList.contains('dark')) de.classList.add('dark');

	document.addEventListener('click', ({ target }) => {
		if(target.closest?.('[data-toggle-theme-variant]'))
		{
			if(de.classList.contains('dark'))
			{
				de.classList.add('light');
				de.classList.remove('dark');
				try { sessionStorage.setItem('current-theme-variant', 'light'); } catch(error) {}
			}
			else
			{
				de.classList.add('dark');
				de.classList.remove('light');
				try { sessionStorage.setItem('current-theme-variant', 'dark'); } catch(error) {}
			}
		}
	});
});
