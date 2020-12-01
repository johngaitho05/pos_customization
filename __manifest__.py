# -*- coding: utf-8 -*-
##############################################################################
#
# Part of Caret IT Solutions Pvt. Ltd. (Website: www.caretit.com).
# See LICENSE file for full copyright and licensing details.
#
##############################################################################


{
    'name': 'POS Customization',

    'summary': 'POS Customization',

    'description': """
        POS Customization
    """,

    'author': "Hyperthink Systems Limited",

    'category': 'Sales/Point Of Sale',
    'version': '2.0',

    # any module necessary for this one to work correctly
    'depends': ['base', 'contacts', 'point_of_sale'],

    # always loaded
    'data': [
        'security/ir.model.access.csv',
        'views/assets.xml',
        'views/pos_payment_method.xml',
        'views/res_partner_view.xml',
        'views/pos_config_view.xml',
        'views/assurance_company_view.xml',
    ],
    'qweb': ['static/src/xml/*.xml'],
    'application': True,
    'installable': True,
    'auto_install': False
}
