# SPDX-License-Identifier: BSD-3-Clause
# SPDX-FileCopyrightText: 2024 Carl Schwan <carl@carlschwan.eu>

add_definitions(-DDATA_DIR="${CMAKE_CURRENT_SOURCE_DIR}/testdata" )

ecm_add_test(navigationcontrollertest.cpp
    TEST_NAME navigationcontroller
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(notebooksmodeltest.cpp
    TEST_NAME notebooksmodel
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)


ecm_add_test(maildirimporttest.cpp
    TEST_NAME maildirimporttest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(richdocumenthandlertest.cpp
    TEST_NAME richdocumenthandlertest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(mermaidtest.cpp
    TEST_NAME mermaidtest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(frontmattertest.cpp
    TEST_NAME frontmattertest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(syncenginetest.cpp
    TEST_NAME syncenginetest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(syncactivitytest.cpp
    TEST_NAME syncactivitytest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

# The Drive backend is tested against a local fake of the Drive API.
find_package(Qt6 ${QT_MIN_VERSION} QUIET COMPONENTS HttpServer)
if(TARGET Qt6::HttpServer)
    ecm_add_test(googledrivetest.cpp
        TEST_NAME googledrivetest
        LINK_LIBRARIES marknote_static Qt::Test Qt6::HttpServer
        NAME_PREFIX "marknote-"
    )
    ecm_add_test(googleauthtest.cpp
        TEST_NAME googleauthtest
        LINK_LIBRARIES marknote_static Qt::Test Qt6::HttpServer
        NAME_PREFIX "marknote-"
    )
endif()

ecm_add_test(imagepathstest.cpp
    TEST_NAME imagepathstest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(tokenstoretest.cpp
    TEST_NAME tokenstoretest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(cryptotest.cpp
    TEST_NAME cryptotest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(vaultstest.cpp
    TEST_NAME vaultstest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(ordertest.cpp
    TEST_NAME ordertest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)

ecm_add_test(todotest.cpp
    TEST_NAME todotest
    LINK_LIBRARIES marknote_static Qt::Test
    NAME_PREFIX "marknote-"
)
target_compile_definitions(todotest PRIVATE TODO_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/data/todo.json")
