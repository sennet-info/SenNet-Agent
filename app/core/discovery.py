from functools import lru_cache

from modules.db_connector import DataFetcher


@lru_cache(maxsize=16)
def _get_data_fetcher(url: str, token: str, org: str) -> DataFetcher:
    return DataFetcher(url, token, org)


def list_clients(auth_config):
    fetcher = _get_data_fetcher(auth_config["url"], auth_config["token"], auth_config["org"])
    return fetcher.get_clients(auth_config["bucket"])


def list_sites(auth_config, client):
    fetcher = _get_data_fetcher(auth_config["url"], auth_config["token"], auth_config["org"])
    return fetcher.get_sites(auth_config["bucket"], client)


def list_serials(auth_config, client, site):
    fetcher = _get_data_fetcher(auth_config["url"], auth_config["token"], auth_config["org"])
    return fetcher.get_serials(auth_config["bucket"], client, site)


def list_devices(auth_config, client, site, serial=None):
    fetcher = _get_data_fetcher(auth_config["url"], auth_config["token"], auth_config["org"])
    return fetcher.get_devices(auth_config["bucket"], client, site, serial=serial)
